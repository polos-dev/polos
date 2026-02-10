/**
 * StepHelper implementation.
 *
 * Provides durable operations within workflows including step execution,
 * workflow invocation, waiting, and event publishing.
 *
 */

import { randomUUID } from 'node:crypto';
import type { Workflow, WorkflowHandle, WorkflowStatus } from '../types/workflow.js';
import { retry, type RetryOptions } from '../utils/retry.js';

/**
 * Error thrown when a step execution fails.
 */
export class StepExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepExecutionError';
  }
}

/**
 * Internal error thrown when workflow execution must pause to wait.
 * @internal
 */
export class WaitError extends Error {
  /** Discriminator for runtime checks (survives minification unlike instanceof). */
  readonly __isWaitError = true as const;
  /** Structured data about the wait. */
  readonly waitData: Record<string, unknown>;

  constructor(reason: string, waitData?: Record<string, unknown>) {
    super(reason);
    this.name = 'WaitError';
    this.waitData = waitData ?? {};
  }
}

/**
 * Type guard for WaitError — works across module boundaries and minification.
 * @internal
 */
export function isWaitError(error: unknown): error is WaitError {
  return (
    error instanceof WaitError ||
    (typeof error === 'object' &&
      error !== null &&
      '__isWaitError' in error &&
      (error as Record<string, unknown>)['__isWaitError'] === true)
  );
}

/**
 * Options for step execution.
 */
export interface StepOptions {
  /** Maximum retry attempts (default: 2) */
  maxRetries?: number | undefined;
  /** Initial delay for exponential backoff in ms (default: 1000) */
  baseDelay?: number | undefined;
  /** Maximum delay for exponential backoff in ms (default: 10000) */
  maxDelay?: number | undefined;
  /** Input data to record in the trace span (for observability) */
  input?: unknown;
}

/**
 * Options for invoking another workflow.
 */
export interface InvokeOptions {
  /** Concurrency key for rate limiting */
  concurrencyKey?: string | undefined;
  /** Initial state for the sub-workflow */
  initialState?: Record<string, unknown> | undefined;
  /** Queue name to run the sub-workflow on */
  queue?: string | undefined;
  /** Timeout in seconds for the sub-workflow execution */
  runTimeoutSeconds?: number | undefined;
}

/**
 * Options for waiting a duration.
 */
export interface WaitForOptions {
  /** Seconds to wait */
  seconds?: number | undefined;
  /** Minutes to wait */
  minutes?: number | undefined;
  /** Hours to wait */
  hours?: number | undefined;
  /** Days to wait */
  days?: number | undefined;
  /** Weeks to wait */
  weeks?: number | undefined;
}

/**
 * Options for waiting on an event.
 */
export interface WaitForEventOptions {
  /** Event topic to wait on */
  topic: string;
  /** Timeout in seconds */
  timeout?: number | undefined;
}

/**
 * Options for publishing an event.
 */
export interface PublishEventOptions {
  /** Event topic */
  topic: string;
  /** Event type */
  type?: string | undefined;
  /** Event data */
  data: unknown;
}

/**
 * Options for suspending workflow execution.
 */
export interface SuspendOptions<T = unknown> {
  /** Data to include in the suspension */
  data?: T | undefined;
  /** Timeout in seconds before auto-resuming */
  timeout?: number | undefined;
}

/**
 * Options for resuming a suspended workflow.
 */
export interface ResumeOptions {
  /** The step key used in the original suspend() call */
  suspendStepKey: string;
  /** The root execution ID of the suspended execution */
  suspendExecutionId: string;
  /** The root workflow ID of the suspended execution */
  suspendWorkflowId: string;
  /** Data to pass in the resume event */
  data: unknown;
}

/**
 * Input for batch workflow invocation.
 */
export interface BatchWorkflowInput {
  /** Workflow to invoke (ID string or Workflow object) */
  workflow: string | Workflow;
  /** Payload for this invocation */
  payload: unknown;
  /** Initial state for the sub-workflow */
  initialState?: Record<string, unknown> | undefined;
  /** Timeout in seconds for the sub-workflow execution */
  runTimeoutSeconds?: number | undefined;
}

/**
 * Configuration for agent invocation.
 * Matches Python AgentRunConfig.
 *
 * Created by AgentWorkflow.withInput(). Used by step.agentInvoke(),
 * step.batchAgentInvoke(), and the standalone batchAgentInvoke().
 */
export class AgentRunConfig {
  /** The agent workflow */
  readonly agent: Workflow;
  /** Input for the agent (string message or message array) */
  readonly input: string | Record<string, unknown>[];
  /** Session ID */
  readonly sessionId: string | undefined;
  /** Conversation ID for history tracking */
  readonly conversationId: string | undefined;
  /** User ID */
  readonly userId: string | undefined;
  /** Whether to stream the response */
  readonly streaming: boolean;
  /** Initial state for the agent workflow */
  readonly initialState: Record<string, unknown> | undefined;
  /** Timeout in seconds for execution */
  readonly runTimeoutSeconds: number | undefined;
  /** Additional fields to include in the payload */
  readonly kwargs: Record<string, unknown>;

  constructor(options: {
    agent: Workflow;
    input: string | Record<string, unknown>[];
    sessionId?: string;
    conversationId?: string;
    userId?: string;
    streaming?: boolean;
    initialState?: Record<string, unknown>;
    runTimeoutSeconds?: number;
    kwargs?: Record<string, unknown>;
  }) {
    this.agent = options.agent;
    this.input = options.input;
    this.sessionId = options.sessionId;
    this.conversationId = options.conversationId;
    this.userId = options.userId;
    this.streaming = options.streaming ?? false;
    this.initialState = options.initialState;
    this.runTimeoutSeconds = options.runTimeoutSeconds;
    this.kwargs = options.kwargs ?? {};
  }
}

/**
 * Step execution result stored for replay.
 */
export interface StepResult<T = unknown> {
  /** Step key */
  key: string;
  /** Result value */
  value: T;
  /** When the step completed */
  completedAt: Date;
}

/**
 * Internal step store interface for caching step results.
 */
export interface StepStore {
  /** Get a cached step result */

  get<T>(key: string): StepResult<T> | undefined;
  /** Store a step result */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is used for input type inference
  set<T>(key: string, value: T): void;
  /** Check if a step has been executed */
  has(key: string): boolean;
}

/**
 * Create an in-memory step store.
 */
export function createStepStore(): StepStore {
  const results = new Map<string, StepResult>();

  return {
    get<T>(key: string): StepResult<T> | undefined {
      return results.get(key) as StepResult<T> | undefined;
    },
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is used for input type inference
    set<T>(key: string, value: T): void {
      results.set(key, {
        key,
        value,
        completedAt: new Date(),
      });
    },
    has(key: string): boolean {
      return results.has(key);
    },
  };
}

/**
 * StepHelper provides durable operations within workflows.
 */
export interface StepHelper {
  /**
   * Execute a function as a durable step.
   * Results are cached and replayed on retry.
   */
  run<T>(key: string, fn: () => T | Promise<T>, options?: StepOptions): Promise<T>;

  /**
   * Invoke another workflow (fire and forget).
   */
  invoke<TPayload = unknown, TResult = unknown>(
    key: string,
    workflow: string | Workflow<TPayload, unknown, TResult>,
    payload: TPayload,
    options?: InvokeOptions
  ): Promise<WorkflowHandle<TResult>>;

  /**
   * Invoke another workflow and wait for result.
   */
  invokeAndWait<TPayload = unknown, TResult = unknown>(
    key: string,
    workflow: string | Workflow<TPayload, unknown, TResult>,
    payload: TPayload,
    options?: InvokeOptions
  ): Promise<TResult>;

  /**
   * Invoke multiple workflows in batch.
   */
  batchInvoke(key: string, items: BatchWorkflowInput[]): Promise<WorkflowHandle<unknown>[]>;

  /**
   * Invoke multiple workflows and wait for all results.
   */
  batchInvokeAndWait<T>(key: string, items: BatchWorkflowInput[]): Promise<T[]>;

  /**
   * Wait for a time duration.
   */
  waitFor(key: string, options: WaitForOptions): Promise<void>;

  /**
   * Wait until a specific date/time.
   */
  waitUntil(key: string, date: Date): Promise<void>;

  /**
   * Wait for an event on a topic.
   */
  waitForEvent<T>(key: string, options: WaitForEventOptions): Promise<T>;

  /**
   * Publish an event to a topic.
   */
  publishEvent(key: string, options: PublishEventOptions): Promise<void>;

  /**
   * Publish an event on the current workflow's topic.
   */
  publishWorkflowEvent(key: string, options: { data: unknown; type?: string }): Promise<void>;

  /**
   * Suspend workflow execution and wait for external resume.
   */
  suspend<T = unknown, R = unknown>(key: string, options?: SuspendOptions<T>): Promise<R>;

  /**
   * Resume a suspended execution by publishing a resume event.
   */
  resume(key: string, options: ResumeOptions): Promise<void>;

  /**
   * Generate a durable UUID (persisted via step key).
   */
  uuid(key: string): Promise<string>;

  /**
   * Get current timestamp in milliseconds (persisted via step key).
   */
  now(key: string): Promise<number>;

  /**
   * Generate a durable random number between 0 and 1 (persisted via step key).
   */
  random(key: string): Promise<number>;

  /**
   * Invoke an agent workflow (fire and forget).
   */
  agentInvoke(key: string, config: AgentRunConfig): Promise<WorkflowHandle<unknown>>;

  /**
   * Invoke an agent workflow and wait for result.
   */
  agentInvokeAndWait(key: string, config: AgentRunConfig): Promise<unknown>;

  /**
   * Invoke multiple agent workflows in batch (fire and forget).
   */
  batchAgentInvoke(key: string, configs: AgentRunConfig[]): Promise<WorkflowHandle<unknown>[]>;

  /**
   * Invoke multiple agent workflows in batch and wait for all results.
   */
  batchAgentInvokeAndWait<T>(key: string, configs: AgentRunConfig[]): Promise<T[]>;

  /**
   * Create a custom traced span around an async operation.
   */
  trace<T>(
    name: string,
    fn: (span: unknown) => Promise<T>,
    attributes?: Record<string, string | number | boolean>
  ): Promise<T>;
}

/**
 * Options for creating a StepHelper.
 */
export interface CreateStepHelperOptions {
  /** Step store for caching results */
  store: StepStore;
}

/**
 * Create a local StepHelper instance (for testing / local execution).
 * The real orchestrator-backed implementation is in runtime/executor.ts.
 */
export function createStepHelper(options: CreateStepHelperOptions): StepHelper {
  const { store } = options;

  return {
    async run<T>(key: string, fn: () => T | Promise<T>, stepOptions?: StepOptions): Promise<T> {
      // Check if step result is cached
      const cached = store.get<T>(key);
      if (cached) {
        return cached.value;
      }

      // Execute with retry
      const retryOptions: RetryOptions = {
        maxRetries: stepOptions?.maxRetries ?? 2,
        baseDelay: stepOptions?.baseDelay ?? 1000,
        maxDelay: stepOptions?.maxDelay ?? 10000,
      };

      try {
        const result = await retry(fn, retryOptions);
        store.set(key, result);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new StepExecutionError(
          `Step execution failed after ${String(retryOptions.maxRetries)} retries: ${errorMessage}`
        );
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation
    async invoke<TPayload, TResult>(
      key: string,
      _workflow: string | Workflow<TPayload, unknown, TResult>,
      _payload: TPayload,
      _options?: InvokeOptions
    ): Promise<WorkflowHandle<TResult>> {
      const cached = store.get<WorkflowHandle<TResult>>(key);
      if (cached) {
        return cached.value;
      }

      // Local stub — no orchestrator
      const executionId = randomUUID();
      const handle: WorkflowHandle<TResult> = {
        executionId,
        // eslint-disable-next-line @typescript-eslint/require-await -- stub
        getStatus: async (): Promise<WorkflowStatus<TResult>> => ({
          status: 'queued',
          createdAt: new Date(),
        }),
        // eslint-disable-next-line @typescript-eslint/require-await -- stub
        waitForResult: async (): Promise<TResult> => {
          throw new Error('Orchestrator client not configured');
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- stub
        cancel: async (): Promise<void> => {
          throw new Error('Orchestrator client not configured');
        },
      };

      store.set(key, handle);
      return handle;
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub throws WaitError
    async invokeAndWait<TPayload, TResult>(
      key: string,
      workflow: string | Workflow<TPayload, unknown, TResult>,
      _payload: TPayload,
      _options?: InvokeOptions
    ): Promise<TResult> {
      // Check cache (matching Python: _invoke with wait_for_subworkflow=True returns cached result)
      const cached = store.get<TResult>(key);
      if (cached) {
        return cached.value;
      }

      // Local stub — no orchestrator. Throw WaitError (matching Python WaitException).
      const workflowId = typeof workflow === 'string' ? workflow : workflow.id;
      throw new WaitError(`Waiting for sub-workflow '${workflowId}' to complete`, { workflowId });
    },

    async batchInvoke(
      key: string,
      items: BatchWorkflowInput[]
    ): Promise<WorkflowHandle<unknown>[]> {
      const cached = store.get<WorkflowHandle<unknown>[]>(key);
      if (cached) {
        return cached.value;
      }

      const handles: WorkflowHandle<unknown>[] = [];
      for (const [index, item] of items.entries()) {
        const handle = await this.invoke(`${key}:${String(index)}`, item.workflow, item.payload);
        handles.push(handle);
      }

      store.set(key, handles);
      return handles;
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub throws WaitError
    async batchInvokeAndWait<T>(key: string, items: BatchWorkflowInput[]): Promise<T[]> {
      if (items.length === 0) return [];

      // Check cache (matching Python: _check_existing_step → reconstruct results)
      const cached = store.get<T[]>(key);
      if (cached) {
        return cached.value;
      }

      // Local stub — no orchestrator. Throw WaitError (matching Python WaitException).
      const workflowIds = items
        .map((item) => (typeof item.workflow === 'string' ? item.workflow : item.workflow.id))
        .join(', ');
      throw new WaitError(`Waiting for sub-workflows [${workflowIds}] to complete`, {
        workflowIds: workflowIds.split(', '),
      });
    },

    async waitFor(key: string, options: WaitForOptions): Promise<void> {
      const cached = store.get(key);
      if (cached) return;

      let totalSeconds = 0;
      if (options.seconds) totalSeconds += options.seconds;
      if (options.minutes) totalSeconds += options.minutes * 60;
      if (options.hours) totalSeconds += options.hours * 3600;
      if (options.days) totalSeconds += options.days * 86400;
      if (options.weeks) totalSeconds += options.weeks * 604800;

      const totalMs = totalSeconds * 1000;
      await new Promise((resolve) => setTimeout(resolve, totalMs));
      store.set(key, { wait_until: new Date(Date.now() + totalMs).toISOString() });
    },

    async waitUntil(key: string, date: Date): Promise<void> {
      const cached = store.get(key);
      if (cached) return;

      const now = Date.now();
      const waitMs = Math.max(0, date.getTime() - now);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      store.set(key, { wait_until: date.toISOString() });
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation
    async waitForEvent<T>(key: string, eventOptions: WaitForEventOptions): Promise<T> {
      const cached = store.get<T>(key);
      if (cached) {
        return cached.value;
      }
      throw new Error(`waitForEvent not implemented locally: ${eventOptions.topic}`);
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation
    async publishEvent(key: string, _options: PublishEventOptions): Promise<void> {
      if (store.has(key)) return;
      store.set(key, null);
    },

    async publishWorkflowEvent(
      key: string,
      options: { data: unknown; type?: string }
    ): Promise<void> {
      // Local stub — no workflow topic available
      return this.publishEvent(key, { topic: 'local', ...options });
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation
    async suspend<T, R>(key: string, _options?: SuspendOptions<T>): Promise<R> {
      const cached = store.get<R>(key);
      if (cached) {
        return cached.value;
      }
      throw new Error('suspend not implemented locally');
    },

    async resume(key: string, options: ResumeOptions): Promise<void> {
      const topic = `workflow/${options.suspendWorkflowId}/${options.suspendExecutionId}`;
      return this.publishEvent(key, {
        topic,
        type: `resume_${options.suspendStepKey}`,
        data: options.data,
      });
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation
    async uuid(key: string): Promise<string> {
      const cached = store.get<string>(key);
      if (cached) {
        return cached.value;
      }
      const generated = randomUUID();
      store.set(key, generated);
      return generated;
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation
    async now(key: string): Promise<number> {
      const cached = store.get<number>(key);
      if (cached) {
        return cached.value;
      }
      const timestamp = Date.now();
      store.set(key, timestamp);
      return timestamp;
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation
    async random(key: string): Promise<number> {
      const cached = store.get<number>(key);
      if (cached) {
        return cached.value;
      }
      const value = Math.random();
      store.set(key, value);
      return value;
    },

    // --- Agent invoke stubs (local — delegates to invoke/batchInvoke) ---
    // Matches Python step.py agent_invoke / batch_agent_invoke etc.

    async agentInvoke(key: string, config: AgentRunConfig): Promise<WorkflowHandle<unknown>> {
      const payload = {
        input: config.input,
        streaming: config.streaming,
        session_id: undefined as string | undefined,
        user_id: undefined as string | undefined,
        conversation_id: config.conversationId,
        ...config.kwargs,
      };
      return this.invoke(key, config.agent, payload);
    },

    async agentInvokeAndWait(key: string, config: AgentRunConfig): Promise<unknown> {
      const payload = {
        input: config.input,
        streaming: config.streaming,
        session_id: undefined as string | undefined,
        user_id: undefined as string | undefined,
        conversation_id: config.conversationId,
        ...config.kwargs,
      };
      return this.invokeAndWait(key, config.agent, payload);
    },

    async batchAgentInvoke(
      key: string,
      configs: AgentRunConfig[]
    ): Promise<WorkflowHandle<unknown>[]> {
      const items: BatchWorkflowInput[] = configs.map((config) => ({
        workflow: config.agent,
        payload: {
          input: config.input,
          streaming: config.streaming,
          session_id: undefined as string | undefined,
          user_id: undefined as string | undefined,
          conversation_id: config.conversationId,
          ...config.kwargs,
        },
        initialState: config.initialState,
        runTimeoutSeconds: config.runTimeoutSeconds,
      }));
      return this.batchInvoke(key, items);
    },

    async batchAgentInvokeAndWait<T>(key: string, configs: AgentRunConfig[]): Promise<T[]> {
      const items: BatchWorkflowInput[] = configs.map((config) => ({
        workflow: config.agent,
        payload: {
          input: config.input,
          streaming: config.streaming,
          session_id: undefined as string | undefined,
          user_id: undefined as string | undefined,
          conversation_id: config.conversationId,
          ...config.kwargs,
        },
        initialState: config.initialState,
        runTimeoutSeconds: config.runTimeoutSeconds,
      }));
      return this.batchInvokeAndWait<T>(key, items);
    },

    async trace<T>(
      _name: string,
      fn: (span: unknown) => Promise<T>,
      _attributes?: Record<string, string | number | boolean>
    ): Promise<T> {
      return fn(undefined);
    },
  };
}
