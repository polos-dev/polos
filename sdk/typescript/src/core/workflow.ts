/**
 * Workflow definition and creation.
 *
 * Provides the defineWorkflow function for creating typed, durable workflows.
 */

import type { ZodType } from 'zod';
import type { WorkflowContext } from './context.js';
import type { Channel } from '../channels/channel.js';
import { globalRegistry } from './registry.js';
import { assertNotInExecutionContext } from '../runtime/execution-context.js';

// Re-export hook types from middleware (single source of truth)
export type {
  HookContext,
  HookResultType,
  HookHandler,
  Hook,
  DefineHookOptions,
} from '../middleware/hook.js';
export {
  HookResult,
  defineHook,
  isHook,
  normalizeHook,
  normalizeHooks,
} from '../middleware/hook.js';

// Import types needed for WorkflowConfig
import type { HookHandler, Hook as HookObject } from '../middleware/hook.js';

/**
 * Queue configuration for workflow execution.
 */
export interface QueueConfig {
  /** Queue name */
  name: string;
  /** Maximum concurrent executions in this queue */
  concurrencyLimit?: number | undefined;
}

/**
 * Schedule configuration for workflows.
 */
export interface ScheduleConfig {
  /** Cron expression (e.g., '0 8 * * *') */
  cron: string;
  /** Timezone for the schedule (e.g., 'America/New_York') */
  timezone?: string | undefined;
}

/**
 * Configuration for defining a workflow.
 */
export interface WorkflowConfig<TPayload = unknown, TState = unknown, TResult = unknown> {
  /** Unique workflow identifier */
  id: string;
  /** Description for team coordination */
  description?: string | undefined;
  /** Workflow type: "workflow", "agent", or "tool" (default: "workflow") */
  workflowType?: string | undefined;
  /** Queue assignment (string name or full config) */
  queue?: string | QueueConfig | undefined;
  /** Schedule for automatic execution. Set to true (without a cron) to mark as dynamically schedulable via client.schedules.create(). */
  schedule?: string | ScheduleConfig | boolean | undefined;
  /** Event topic that triggers this workflow */
  triggerOnEvent?: string | undefined;
  /** Batch size for event-triggered workflows */
  batchSize?: number | undefined;
  /** Batch timeout in seconds for event-triggered workflows */
  batchTimeoutSeconds?: number | undefined;
  /** Zod schema for payload validation */
  payloadSchema?: ZodType<TPayload> | undefined;
  /** Zod schema for state validation and defaults */
  stateSchema?: ZodType<TState> | undefined;
  /** Zod schema for output/result validation */
  outputSchema?: ZodType<TResult> | undefined;
  /** Hook(s) to run before workflow execution (bare function or Hook object) */
  onStart?:
    | HookHandler<TPayload, TState>
    | HookObject<TPayload, TState>
    | (HookHandler<TPayload, TState> | HookObject<TPayload, TState>)[]
    | undefined;
  /** Hook(s) to run after workflow completion (bare function or Hook object) */
  onEnd?:
    | HookHandler<TPayload, TState>
    | HookObject<TPayload, TState>
    | (HookHandler<TPayload, TState> | HookObject<TPayload, TState>)[]
    | undefined;
  /** Notification channels for suspend events. Overrides Worker-level channels. */
  channels?: Channel[] | undefined;
}

/**
 * Workflow handler function type.
 */
export type WorkflowHandler<TPayload, TState, TResult> = (
  ctx: WorkflowContext<TState>,
  payload: TPayload
) => Promise<TResult>;

/**
 * Handle to a running or completed workflow execution.
 */
export interface WorkflowHandle<TResult> {
  /** Execution identifier */
  executionId: string;
  /** Get the current status of the workflow */
  getStatus(): Promise<WorkflowStatus<TResult>>;
  /** Wait for the workflow to complete and return result */
  waitForResult(options?: { timeout?: number }): Promise<TResult>;
  /** Cancel the workflow execution */
  cancel(): Promise<void>;
}

/**
 * Status of a workflow execution.
 */
export interface WorkflowStatus<TResult> {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: TResult | undefined;
  error?: string | undefined;
  createdAt: Date;
  completedAt?: Date | undefined;
}

/**
 * Minimal client interface for workflow.run() and workflow.invoke().
 * PolosClient satisfies this interface structurally.
 */
export interface WorkflowRunClient {
  invoke(
    workflow: string,
    payload?: unknown,
    options?: {
      initialState?: Record<string, unknown>;
      sessionId?: string;
      userId?: string;
      queueName?: string;
      concurrencyKey?: string;
      runTimeoutSeconds?: number;
    }
  ): Promise<{ getResult(timeout?: number): Promise<unknown> }>;
}

/**
 * Options for workflow.run().
 */
export interface WorkflowRunOptions {
  /** Timeout in seconds (default: 600) */
  timeout?: number | undefined;
  /** Initial state for the workflow */
  initialState?: Record<string, unknown> | undefined;
  /** Session ID */
  sessionId?: string | undefined;
  /** User ID */
  userId?: string | undefined;
  /** Queue name override */
  queueName?: string | undefined;
  /** Concurrency key for per-tenant queuing */
  concurrencyKey?: string | undefined;
}

/**
 * Workflow instance with configuration and handler.
 */
export interface Workflow<TPayload = unknown, TState = unknown, TResult = unknown> {
  /** Workflow identifier */
  readonly id: string;
  /** Description for team coordination */
  readonly description?: string | undefined;
  /** Workflow configuration */
  readonly config: WorkflowConfig<TPayload, TState, TResult>;
  /** Workflow handler function */
  readonly handler: WorkflowHandler<TPayload, TState, TResult>;
  /** Payload schema (if provided) */
  readonly payloadSchema?: ZodType<TPayload> | undefined;
  /** State schema (if provided) */
  readonly stateSchema?: ZodType<TState> | undefined;
  /** Output schema (if provided) */
  readonly outputSchema?: ZodType<TResult> | undefined;
  /**
   * Run workflow and wait for result (invoke + poll until complete).
   * Cannot be called from within a workflow; use step.invokeAndWait() instead.
   * Matches Python's workflow.run().
   */
  // Method syntax enables bivariant checking so AgentWorkflow can override with specific types
  run(client: WorkflowRunClient, payload: TPayload, options?: WorkflowRunOptions): Promise<TResult>;
}

/**
 * Infer payload type from a workflow.
 */
export type InferPayload<T> = T extends Workflow<infer P> ? P : never;

/**
 * Infer state type from a workflow.
 */
export type InferState<T> = T extends Workflow<unknown, infer S> ? S : never;

/**
 * Infer result type from a workflow.
 */
export type InferResult<T> = T extends Workflow<unknown, unknown, infer R> ? R : never;

/**
 * Options for defineWorkflow.
 */
export interface DefineWorkflowOptions {
  /** Whether to auto-register the workflow in the global registry (default: true) */
  autoRegister?: boolean | undefined;
}

/**
 * Define a workflow with typed payload, state, and result.
 *
 * @example
 * ```typescript
 * import { defineWorkflow } from '@polos/sdk';
 * import { z } from 'zod';
 *
 * const myWorkflow = defineWorkflow({
 *   id: 'my-workflow',
 *   payloadSchema: z.object({ userId: z.string() }),
 *   stateSchema: z.object({ count: z.number().default(0) }),
 * }, async (ctx, payload) => {
 *   ctx.state.count += 1;
 *   return { userId: payload.userId, count: ctx.state.count };
 * });
 * ```
 */
/**
 * Validate that a cron expression uses minute granularity (5 fields), not second granularity (6 fields).
 * @internal
 */
export function validateCronGranularity(cron: string): void {
  const fields = cron.trim().split(/\s+/);
  if (fields.length > 5) {
    throw new Error(
      `Cron expression "${cron}" appears to use second-level granularity (${String(fields.length)} fields). ` +
        'Only minute-level granularity is supported (5 fields: min hour dom month dow).'
    );
  }
}

export function defineWorkflow<TPayload = unknown, TState = unknown, TResult = unknown>(
  config: WorkflowConfig<TPayload, TState, TResult>,
  handler: WorkflowHandler<TPayload, TState, TResult>,
  options?: DefineWorkflowOptions
): Workflow<TPayload, TState, TResult> {
  // Validate cron granularity if schedule is provided (skip boolean-only schedule)
  if (config.schedule && config.schedule !== true) {
    const cron = typeof config.schedule === 'string' ? config.schedule : config.schedule.cron;
    validateCronGranularity(cron);
  }

  const workflow: Workflow<TPayload, TState, TResult> = {
    id: config.id,
    description: config.description,
    config,
    handler,
    payloadSchema: config.payloadSchema,
    stateSchema: config.stateSchema,
    outputSchema: config.outputSchema,
    run: async (client, payload, options) => {
      assertNotInExecutionContext('workflow.run()', 'step.invokeAndWait()');
      const invokeOpts: Record<string, unknown> = {};
      if (options?.initialState !== undefined) invokeOpts['initialState'] = options.initialState;
      if (options?.sessionId !== undefined) invokeOpts['sessionId'] = options.sessionId;
      if (options?.userId !== undefined) invokeOpts['userId'] = options.userId;
      if (options?.queueName !== undefined) invokeOpts['queueName'] = options.queueName;
      if (options?.concurrencyKey !== undefined)
        invokeOpts['concurrencyKey'] = options.concurrencyKey;
      if (options?.timeout !== undefined)
        invokeOpts['runTimeoutSeconds'] = Math.ceil(options.timeout);
      const handle = await client.invoke(config.id, payload, invokeOpts);
      const result = await handle.getResult(options?.timeout ?? 600);
      return result as TResult;
    },
  };

  // Auto-register by default
  if (options?.autoRegister !== false) {
    globalRegistry.register(workflow as Workflow);
  }

  return workflow;
}
