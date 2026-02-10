/**
 * Workflow executor - handles execution of workflows with proper context setup.
 *
 * The createOrchestratorStepHelper function.
 */

import type { ZodSchema, ZodTypeDef } from 'zod';
import type { Workflow } from '../core/workflow.js';
import type { WorkflowContext, AgentContext } from '../core/context.js';
import type { AgentWorkflow } from '../agents/agent.js';
import type {
  StepHelper,
  StepOptions,
  InvokeOptions,
  WaitForOptions,
  WaitForEventOptions,
  PublishEventOptions,
  SuspendOptions,
  ResumeOptions,
  BatchWorkflowInput,
} from '../core/step.js';
import type { AgentRunConfig } from '../core/step.js';
import { StepExecutionError, WaitError, isWaitError } from '../core/step.js';
import type { WorkflowHandle, WorkflowStatus } from '../core/workflow.js';
import type { OrchestratorClient } from './orchestrator-client.js';
import type { ExecutionContext, StepOutput, BatchWorkflowEntry } from './orchestrator-types.js';
import { executeHookChain } from '../middleware/hook-executor.js';
import { normalizeHooks } from '../middleware/hook.js';
import { initializeState, validateState, serializeState } from '../core/state.js';
import { retry, type RetryOptions } from '../utils/retry.js';
import { createLogger } from '../utils/logger.js';
import { getModelId, getModelProvider } from '../llm/types.js';
import { runInExecutionContext, getExecutionContext } from './execution-context.js';
import {
  type Span,
  type SpanContext,
  type Context,
  context as otelContext,
  trace as otelTrace,
} from '@opentelemetry/api';
import {
  getTracer,
  extractTraceparent,
  createContextFromTraceparent,
  createContextWithTraceId,
  generateTraceIdFromExecutionId,
} from '../features/tracing.js';
import {
  getParentSpanContextFromExecutionContext,
  getSpanContextFromExecutionContext,
  setSpanContextInExecutionContext,
} from '../utils/tracing.js';

const logger = createLogger({ name: 'executor' });

/**
 * Options for executing a workflow.
 */
export interface ExecuteWorkflowOptions {
  /** The workflow to execute */
  workflow: Workflow;
  /** Payload for the workflow */
  payload: unknown;
  /** Execution context from orchestrator */
  context: ExecutionContext;
  /** Orchestrator client for API calls */
  orchestratorClient: OrchestratorClient;
  /** Worker ID */
  workerId: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal | undefined;
}

/**
 * Result of workflow execution.
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Result value (if success) */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  result?: unknown | undefined;
  /** Error message (if failure) */
  error?: string | undefined;
  /** Stack trace (if failure) */
  stack?: string | undefined;
  /** Whether the error is retryable */
  retryable?: boolean | undefined;
  /** Whether the execution is paused/waiting (WaitError was thrown) */
  waiting?: boolean | undefined;
  /** Final state after execution */
  finalState?: Record<string, unknown> | undefined;
}

/**
 * Create a WorkflowHandle for a sub-workflow execution.
 */
function createWorkflowHandle<TResult>(
  orchestratorClient: OrchestratorClient,
  executionId: string
): WorkflowHandle<TResult> {
  return {
    executionId,
    async getStatus(): Promise<WorkflowStatus<TResult>> {
      const exec = await orchestratorClient.getExecution(executionId);
      return {
        status:
          exec.status === 'completed'
            ? 'completed'
            : exec.status === 'failed'
              ? 'failed'
              : exec.status === 'cancelled'
                ? 'cancelled'
                : exec.status === 'running' || exec.status === 'claimed'
                  ? 'running'
                  : 'queued',
        result: exec.result as TResult | undefined,
        error: exec.error,
        createdAt: new Date(exec.created_at),
        completedAt: exec.completed_at ? new Date(exec.completed_at) : undefined,
      };
    },
    async waitForResult(opts?: { timeout?: number }): Promise<TResult> {
      const waitOptions = opts?.timeout !== undefined ? { timeout: opts.timeout } : undefined;
      const exec = await orchestratorClient.waitForExecution(executionId, waitOptions);
      if (exec.status === 'failed') {
        throw new Error(exec.error ?? 'Workflow execution failed');
      }
      if (exec.status === 'cancelled') {
        throw new Error('Workflow execution cancelled');
      }
      return exec.result as TResult;
    },
    async cancel(): Promise<void> {
      await orchestratorClient.cancelExecution(executionId);
    },
  };
}

/**
 * Context info passed to the step helper for sub-workflow invocations.
 */
interface StepExecutionContext {
  workflowId: string;
  executionId: string;
  deploymentId: string;
  sessionId?: string | undefined;
  userId?: string | undefined;
  rootExecutionId: string;
  rootWorkflowId: string;
  otelTraceparent?: string | undefined;
}

/**
 * Create a StepHelper backed by the orchestrator.
 */
function createOrchestratorStepHelper(
  orchestratorClient: OrchestratorClient,
  cachedSteps: Map<string, StepOutput>,
  execCtx: StepExecutionContext,
  workerId: string,
  abortSignal?: AbortSignal
): StepHelper {
  // --- Abort check ---
  const checkAborted = (): void => {
    if (abortSignal?.aborted) {
      throw new Error('Execution cancelled');
    }
  };

  /** Check for existing step output. */
  const checkExistingStep = (key: string): StepOutput | undefined => {
    return cachedSteps.get(key);
  };

  /** Handle existing step output — return cached result or throw on failure. */
  const handleExistingStep = (existing: StepOutput): unknown => {
    if (existing.success !== false) {
      return existing.outputs;
    }
    const error = existing.error;
    let errorMessage: string;
    if (typeof error === 'object' && error !== null) {
      const msg = (error as Record<string, unknown>)['message'];
      errorMessage = typeof msg === 'string' ? msg : 'Step execution failed';
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else {
      errorMessage = 'Step execution failed';
    }
    throw new StepExecutionError(errorMessage);
  };

  /** Save step output on success. */
  const saveStepOutput = async (
    key: string,
    result: unknown,
    sourceExecutionId?: string
  ): Promise<void> => {
    // Cache locally
    cachedSteps.set(key, {
      stepKey: key,
      outputs: result,
      completedAt: new Date().toISOString(),
      success: true,
    });

    // Persist to orchestrator
    await orchestratorClient.storeStepOutput(
      execCtx.executionId,
      {
        stepKey: key,
        outputs: result,
        success: true,
        sourceExecutionId,
      },
      workerId
    );
  };

  /** Save step output with error. */
  const saveStepOutputWithError = async (key: string, error: string): Promise<void> => {
    cachedSteps.set(key, {
      stepKey: key,
      outputs: undefined,
      completedAt: new Date().toISOString(),
      success: false,
      error: { message: error },
    });

    await orchestratorClient.storeStepOutput(
      execCtx.executionId,
      {
        stepKey: key,
        error: { message: error },
        success: false,
      },
      workerId
    );
  };

  /** Publish step event fire-and-forget. */
  const publishStepEvent = (
    eventType: string,
    stepKey: string,
    stepType: string,
    inputParams: Record<string, unknown>
  ): void => {
    const topic = `workflow/${execCtx.rootWorkflowId}/${execCtx.rootExecutionId}`;
    orchestratorClient
      .publishEvent({
        topic,
        events: [
          {
            eventType,
            data: {
              step_key: stepKey,
              step_type: stepType,
              data: inputParams,
              _metadata: {
                execution_id: execCtx.executionId,
                workflow_id: execCtx.workflowId,
              },
            },
          },
        ],
        executionId: execCtx.executionId,
        rootExecutionId: execCtx.rootExecutionId,
      })
      .catch((err: unknown) => {
        logger.warn('Failed to publish step event', { error: String(err) });
      });
  };

  // --- Shared invoke helper ---

  const _invoke = async (
    key: string,
    workflow: string | Workflow,
    payload: unknown,
    options?: InvokeOptions & { waitForSubworkflow?: boolean }
  ): Promise<[unknown, boolean]> => {
    const workflowId = typeof workflow === 'string' ? workflow : workflow.id;

    // Check for existing step output
    const existing = checkExistingStep(key);
    if (existing) {
      const result = handleExistingStep(existing);
      return [result, true];
    }

    // Invoke workflow via orchestrator
    const response = await orchestratorClient.invokeWorkflow(workflowId, {
      workflowId,
      payload,
      deploymentId: execCtx.deploymentId,
      parentExecutionId: execCtx.executionId,
      rootExecutionId: execCtx.rootExecutionId,
      rootWorkflowId: execCtx.rootWorkflowId,
      sessionId: execCtx.sessionId,
      userId: execCtx.userId,
      stepKey: options?.waitForSubworkflow ? key : undefined,
      concurrencyKey: options?.concurrencyKey,
      queueName: options?.queue,
      otelTraceparent: getCurrentTraceparent(),
      waitForSubworkflow: options?.waitForSubworkflow ?? false,
      initialState: options?.initialState,
      runTimeoutSeconds: options?.runTimeoutSeconds,
    });

    if (options?.waitForSubworkflow) {
      // No need to save — orchestrator saves step output on sub-workflow completion
      return [undefined, false];
    } else {
      // Save serializable handle data
      const handleData = {
        id: response.execution_id,
        workflow_id: workflowId,
        created_at: response.created_at,
        parent_execution_id: execCtx.executionId,
        root_workflow_id: execCtx.rootWorkflowId,
        root_execution_id: execCtx.rootExecutionId,
        session_id: execCtx.sessionId,
        user_id: execCtx.userId,
      };
      await saveStepOutput(key, handleData);
      return [handleData, false];
    }
  };

  /** Add a span event on the current span from execution context. */
  const addSpanEventFromExecutionContext = (
    eventName: string,
    eventAttributes: Record<string, string>
  ): void => {
    try {
      const activeSpan = otelTrace.getSpan(otelContext.active());
      if (activeSpan) {
        activeSpan.addEvent(eventName, eventAttributes);
      }
    } catch {
      // ignore — no active span
    }
  };

  /** Get the current traceparent, preferring the active span's context. */
  const getCurrentTraceparent = (): string | undefined => {
    const currentExecCtx = getExecutionContext();
    if (currentExecCtx?._otelSpanContext) {
      try {
        const currentSpan = otelTrace.wrapSpanContext(
          currentExecCtx._otelSpanContext as SpanContext
        );
        const tp = extractTraceparent(currentSpan);
        if (tp) return tp;
      } catch {
        // fallback
      }
    }
    return execCtx.otelTraceparent;
  };

  // --- StepHelper implementation ---

  return {
    async run<T>(key: string, fn: () => T | Promise<T>, options?: StepOptions): Promise<T> {
      checkAborted();

      const existing = checkExistingStep(key);
      if (existing) {
        return handleExistingStep(existing) as T;
      }

      const retryOpts: RetryOptions = {
        maxRetries: options?.maxRetries ?? 2,
        baseDelay: options?.baseDelay ?? 1000,
        maxDelay: options?.maxDelay ?? 10000,
      };

      // Publish step_start event
      publishStepEvent('step_start', key, 'run', {
        max_retries: retryOpts.maxRetries ?? 2,
        base_delay: retryOpts.baseDelay ?? 1000,
        max_delay: retryOpts.maxDelay ?? 10000,
      });

      // Create step span
      const tracer = getTracer();
      let span: Span | undefined;
      let oldSpanContext: SpanContext | undefined;
      const execContextData = getExecutionContext();

      if (tracer) {
        const parentContext = getParentSpanContextFromExecutionContext(execContextData);
        span = tracer.startSpan(
          `step.${key}`,
          {
            attributes: { 'step.key': key, 'step.type': 'run' },
          },
          parentContext
        );
        oldSpanContext = getSpanContextFromExecutionContext(execContextData);
        setSpanContextInExecutionContext(execContextData, span.spanContext());

        // Record step input if provided
        if (options?.input !== undefined) {
          try {
            span.setAttribute('step.input', JSON.stringify(options.input));
          } catch {
            /* ignore */
          }
        }
      }

      try {
        const result = await retry(fn, retryOpts);

        // Publish step_finish event (fire-and-forget)
        publishStepEvent('step_finish', key, 'run', {});

        // Save step output on success
        await saveStepOutput(key, result);

        if (span) {
          span.setStatus({ code: 1 /* OK */ });
          try {
            span.setAttribute('step.output', JSON.stringify(result));
          } catch {
            /* ignore */
          }
          span.setAttribute('step.status', 'completed');
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        logger.error(
          `Step '${key}' failed after ${String(retryOpts.maxRetries)} retries: ${errorMessage}`,
          {
            stepKey: key,
            error: errorMessage,
            stack: errorStack,
          }
        );

        if (span) {
          span.setStatus({ code: 2 /* ERROR */, message: errorMessage });
          if (error instanceof Error) {
            span.recordException(error);
          }
          span.setAttribute('step.status', 'failed');
          try {
            span.setAttribute('step.error', JSON.stringify({ message: errorMessage }));
          } catch {
            /* ignore */
          }
        }

        // Save error to step output
        await saveStepOutputWithError(key, errorMessage);

        throw new StepExecutionError(
          `Step execution failed after ${String(retryOpts.maxRetries)} retries: ${errorMessage}`
        );
      } finally {
        if (span) {
          setSpanContextInExecutionContext(execContextData, oldSpanContext);
          span.end();
        }
      }
    },

    async invoke<TPayload, TResult>(
      key: string,
      workflow: string | Workflow<TPayload, unknown, TResult>,
      payload: TPayload,
      options?: InvokeOptions
    ): Promise<WorkflowHandle<TResult>> {
      checkAborted();
      const workflowIdOrStr = typeof workflow === 'string' ? workflow : workflow.id;
      const [result] = await _invoke(key, workflowIdOrStr, payload, {
        ...options,
        waitForSubworkflow: false,
      });
      // result is serializable handle data { id, workflow_id, ... }
      const handleData = result as { id: string };
      return createWorkflowHandle<TResult>(orchestratorClient, handleData.id);
    },

    async invokeAndWait<TPayload, TResult>(
      key: string,
      workflow: string | Workflow<TPayload, unknown, TResult>,
      payload: TPayload,
      options?: InvokeOptions
    ): Promise<TResult> {
      checkAborted();
      const workflowId = typeof workflow === 'string' ? workflow : workflow.id;
      const [result, found] = await _invoke(key, workflowId, payload, {
        ...options,
        waitForSubworkflow: true,
      });
      if (found) {
        return result as TResult;
      }
      throw new WaitError(`Waiting for sub-workflow ${workflowId} to complete`, { workflowId });
    },

    async batchInvoke(
      key: string,
      items: BatchWorkflowInput[]
    ): Promise<WorkflowHandle<unknown>[]> {
      checkAborted();

      if (items.length === 0) return [];

      // Check for existing step output
      const existing = checkExistingStep(key);
      if (existing) {
        const cachedData = handleExistingStep(existing) as { id: string }[];
        return cachedData.map((d) => createWorkflowHandle<unknown>(orchestratorClient, d.id));
      }

      // Build batch request
      const workflows: BatchWorkflowEntry[] = items.map((item) => {
        const workflowId = typeof item.workflow === 'string' ? item.workflow : item.workflow.id;
        const entry: BatchWorkflowEntry = {
          workflowId,
          payload: item.payload,
          initialState: item.initialState,
          runTimeoutSeconds: item.runTimeoutSeconds,
        };
        // Extract queue info from Workflow config if available
        if (typeof item.workflow !== 'string') {
          const config = item.workflow.config;
          if (typeof config.queue === 'string') {
            entry.queueName = config.queue;
          } else if (config.queue) {
            entry.queueName = config.queue.name;
            entry.queueConcurrencyLimit = config.queue.concurrencyLimit;
          }
        }
        return entry;
      });

      const response = await orchestratorClient.batchInvokeWorkflows({
        workflows,
        deploymentId: execCtx.deploymentId,
        parentExecutionId: execCtx.executionId,
        rootExecutionId: execCtx.rootExecutionId,
        rootWorkflowId: execCtx.rootWorkflowId,
        sessionId: execCtx.sessionId,
        userId: execCtx.userId,
        waitForSubworkflow: false,
        otelTraceparent: getCurrentTraceparent(),
      });

      // Save serializable handle data
      const handleData = response.executions.map((exec, i) => {
        const item = items[i];
        const wf = item?.workflow;
        const wfId = typeof wf === 'string' ? wf : wf?.id;
        return {
          id: exec.execution_id,
          workflow_id: wfId,
          created_at: exec.created_at,
          parent_execution_id: execCtx.executionId,
          root_workflow_id: execCtx.rootWorkflowId,
          root_execution_id: execCtx.rootExecutionId,
          session_id: execCtx.sessionId,
          user_id: execCtx.userId,
        };
      });

      await saveStepOutput(key, handleData);
      return handleData.map((d) => createWorkflowHandle<unknown>(orchestratorClient, d.id));
    },

    async batchInvokeAndWait<T>(key: string, items: BatchWorkflowInput[]): Promise<T[]> {
      checkAborted();

      if (items.length === 0) return [];

      // Check for existing step output
      const existing = checkExistingStep(key);
      if (existing) {
        const raw = handleExistingStep(existing);
        // The orchestrator stores batch results as [{workflow_id, success, result, error}, ...].
        // Unwrap: extract .result from each item
        if (Array.isArray(raw)) {
          return raw.map((item: unknown) => {
            if (item && typeof item === 'object' && 'result' in item) {
              return (item as Record<string, unknown>)['result'] as T;
            }
            return item as T;
          });
        }
        return raw as T[];
      }

      // Build batch request with waitForSubworkflow=true
      const workflows: BatchWorkflowEntry[] = items.map((item) => {
        const workflowId = typeof item.workflow === 'string' ? item.workflow : item.workflow.id;
        const entry: BatchWorkflowEntry = {
          workflowId,
          payload: item.payload,
          initialState: item.initialState,
          runTimeoutSeconds: item.runTimeoutSeconds,
        };
        if (typeof item.workflow !== 'string') {
          const config = item.workflow.config;
          if (typeof config.queue === 'string') {
            entry.queueName = config.queue;
          } else if (config.queue) {
            entry.queueName = config.queue.name;
            entry.queueConcurrencyLimit = config.queue.concurrencyLimit;
          }
        }
        return entry;
      });

      await orchestratorClient.batchInvokeWorkflows({
        workflows,
        deploymentId: execCtx.deploymentId,
        parentExecutionId: execCtx.executionId,
        rootExecutionId: execCtx.rootExecutionId,
        rootWorkflowId: execCtx.rootWorkflowId,
        stepKey: key,
        sessionId: execCtx.sessionId,
        userId: execCtx.userId,
        waitForSubworkflow: true,
        otelTraceparent: getCurrentTraceparent(),
      });

      // Pause execution — orchestrator resumes when all sub-workflows complete
      const workflowIds = items
        .map((item) => (typeof item.workflow === 'string' ? item.workflow : item.workflow.id))
        .join(', ');
      throw new WaitError(`Waiting for sub-workflows [${workflowIds}] to complete`, {
        workflowIds: workflowIds.split(', '),
      });
    },

    async waitFor(key: string, options: WaitForOptions): Promise<void> {
      checkAborted();

      const existing = checkExistingStep(key);
      if (existing) {
        handleExistingStep(existing);
        return;
      }

      // Calculate total wait seconds
      let totalSeconds = 0;
      if (options.seconds) totalSeconds += options.seconds;
      if (options.minutes) totalSeconds += options.minutes * 60;
      if (options.hours) totalSeconds += options.hours * 3600;
      if (options.days) totalSeconds += options.days * 86400;
      if (options.weeks) totalSeconds += options.weeks * 604800;

      if (totalSeconds <= 0) {
        await saveStepOutputWithError(key, 'Wait duration must be positive');
        throw new StepExecutionError('Wait duration must be positive');
      }

      const waitUntil = new Date(Date.now() + totalSeconds * 1000);

      // Add span event
      addSpanEventFromExecutionContext('step.wait_for', {
        'step.key': key,
        'wait.seconds': String(totalSeconds),
        'wait.until': waitUntil.toISOString(),
      });

      // Get wait threshold
      const waitThreshold = Number(process.env['POLOS_WAIT_THRESHOLD_SECONDS'] ?? '10');

      if (totalSeconds <= waitThreshold) {
        // Short wait — sleep locally
        await new Promise((resolve) => setTimeout(resolve, totalSeconds * 1000));
        await saveStepOutput(key, { wait_until: waitUntil.toISOString() });
        return;
      }

      // Long wait — pause execution via orchestrator
      await orchestratorClient.setWaiting(
        execCtx.executionId,
        {
          stepKey: key,
          waitType: 'time',
          waitUntil: waitUntil.toISOString(),
        },
        workerId
      );

      throw new WaitError(`Waiting until ${waitUntil.toISOString()}`, {
        waitUntil: waitUntil.toISOString(),
      });
    },

    async waitUntil(key: string, date: Date): Promise<void> {
      checkAborted();

      const existing = checkExistingStep(key);
      if (existing) {
        handleExistingStep(existing);
        return;
      }

      const now = Date.now();
      const waitSeconds = (date.getTime() - now) / 1000;

      if (waitSeconds < 0) {
        await saveStepOutputWithError(key, `Wait date ${date.toISOString()} is in the past`);
        throw new StepExecutionError(`Wait date ${date.toISOString()} is in the past`);
      }

      // Add span event
      addSpanEventFromExecutionContext('step.wait_until', {
        'step.key': key,
        'wait.until': date.toISOString(),
      });

      const waitThreshold = Number(process.env['POLOS_WAIT_THRESHOLD_SECONDS'] ?? '10');

      if (waitSeconds <= waitThreshold) {
        // Short wait — sleep locally
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
        await saveStepOutput(key, { wait_until: date.toISOString() });
        return;
      }

      // Long wait — pause execution via orchestrator
      await orchestratorClient.setWaiting(
        execCtx.executionId,
        {
          stepKey: key,
          waitType: 'time',
          waitUntil: date.toISOString(),
        },
        workerId
      );

      throw new WaitError(`Waiting until ${date.toISOString()}`, { waitUntil: date.toISOString() });
    },

    async waitForEvent<T>(key: string, options: WaitForEventOptions): Promise<T> {
      checkAborted();

      const existing = checkExistingStep(key);
      if (existing) {
        return handleExistingStep(existing) as T;
      }

      // Add span event
      const eventAttrs: Record<string, string> = {
        'step.key': key,
        'wait.topic': options.topic,
      };
      if (options.timeout !== undefined) {
        eventAttrs['wait.timeout_seconds'] = String(options.timeout);
      }
      addSpanEventFromExecutionContext('step.wait_for_event', eventAttrs);

      // Calculate expires_at if timeout provided (timeout is in seconds)
      const expiresAt =
        options.timeout !== undefined
          ? new Date(Date.now() + options.timeout * 1000).toISOString()
          : undefined;

      // Set waiting state
      await orchestratorClient.setWaiting(
        execCtx.executionId,
        {
          stepKey: key,
          waitType: 'event',
          waitTopic: options.topic,
          waitUntil: expiresAt,
          expiresAt,
        },
        workerId
      );

      throw new WaitError(`Waiting for event on topic: ${options.topic}`, { topic: options.topic });
    },

    async publishEvent(key: string, options: PublishEventOptions): Promise<void> {
      checkAborted();

      const existing = checkExistingStep(key);
      if (existing) {
        handleExistingStep(existing);
        return;
      }

      await orchestratorClient.publishEvent({
        topic: options.topic,
        events: [
          {
            eventType: options.type,
            data: options.data,
          },
        ],
        executionId: execCtx.executionId,
        rootExecutionId: execCtx.rootExecutionId,
      });

      // Save with null result
      await saveStepOutput(key, null);
    },

    async publishWorkflowEvent(
      key: string,
      options: { data: unknown; type?: string }
    ): Promise<void> {
      const topic = `workflow/${execCtx.rootWorkflowId}/${execCtx.rootExecutionId}`;
      // Delegate to publishEvent
      return this.publishEvent(key, { topic, ...options });
    },

    async suspend<T, R>(key: string, options?: SuspendOptions<T>): Promise<R> {
      checkAborted();

      const existing = checkExistingStep(key);
      if (existing) {
        return handleExistingStep(existing) as R;
      }

      // Publish suspend event on workflow topic
      const topic = `workflow/${execCtx.rootWorkflowId}/${execCtx.rootExecutionId}`;
      await orchestratorClient.publishEvent({
        topic,
        events: [
          {
            eventType: `suspend_${key}`,
            data: options?.data,
          },
        ],
        executionId: execCtx.executionId,
        rootExecutionId: execCtx.rootExecutionId,
      });

      // Calculate expires_at (timeout is in seconds)
      const expiresAt =
        options?.timeout !== undefined
          ? new Date(Date.now() + options.timeout * 1000).toISOString()
          : undefined;

      // Set waiting state
      await orchestratorClient.setWaiting(
        execCtx.executionId,
        {
          stepKey: key,
          waitType: 'suspend',
          waitTopic: topic,
          waitUntil: expiresAt,
          expiresAt,
        },
        workerId
      );

      throw new WaitError(`Waiting for resume event: ${topic}`, { topic });
    },

    async resume(key: string, options: ResumeOptions): Promise<void> {
      const topic = `workflow/${options.suspendWorkflowId}/${options.suspendExecutionId}`;
      // Delegate to publishEvent
      return this.publishEvent(key, {
        topic,
        type: `resume_${options.suspendStepKey}`,
        data: options.data,
      });
    },

    async uuid(key: string): Promise<string> {
      const existing = checkExistingStep(key);
      if (existing) {
        return handleExistingStep(existing) as string;
      }

      const generatedUuid = crypto.randomUUID();
      await saveStepOutput(key, generatedUuid);
      return generatedUuid;
    },

    async now(key: string): Promise<number> {
      const existing = checkExistingStep(key);
      if (existing) {
        return existing.outputs as number;
      }

      const timestamp = Date.now();
      await saveStepOutput(key, timestamp);
      return timestamp;
    },

    async random(key: string): Promise<number> {
      const existing = checkExistingStep(key);
      if (existing) {
        return handleExistingStep(existing) as number;
      }

      const randomValue = Math.random();
      await saveStepOutput(key, randomValue);
      return randomValue;
    },

    async agentInvoke(key: string, config: AgentRunConfig): Promise<WorkflowHandle<unknown>> {
      checkAborted();

      const payload: Record<string, unknown> = {
        input: config.input,
        streaming: config.streaming,
        session_id: execCtx.sessionId,
        user_id: execCtx.userId,
        conversation_id: config.conversationId,
        ...config.kwargs,
      };

      const [result] = await _invoke(key, config.agent, payload, {
        initialState: config.initialState,
        waitForSubworkflow: false,
        runTimeoutSeconds: config.runTimeoutSeconds,
      });

      const handleData = result as { id: string };
      return createWorkflowHandle<unknown>(orchestratorClient, handleData.id);
    },

    async agentInvokeAndWait(key: string, config: AgentRunConfig): Promise<unknown> {
      checkAborted();

      const payload: Record<string, unknown> = {
        input: config.input,
        streaming: config.streaming,
        session_id: execCtx.sessionId,
        user_id: execCtx.userId,
        conversation_id: config.conversationId,
        ...config.kwargs,
      };

      const [result, found] = await _invoke(key, config.agent, payload, {
        initialState: config.initialState,
        waitForSubworkflow: true,
        runTimeoutSeconds: config.runTimeoutSeconds,
      });

      if (found) {
        // Step output is already deserialized JSON.
        return result;
      }

      throw new WaitError(`Waiting for agent workflow '${config.agent.id}' to complete`, {
        agentId: config.agent.id,
      });
    },

    async batchAgentInvoke(
      key: string,
      configs: AgentRunConfig[]
    ): Promise<WorkflowHandle<unknown>[]> {
      checkAborted();

      const workflows: BatchWorkflowInput[] = configs.map((config) => ({
        workflow: config.agent,
        payload: {
          input: config.input,
          streaming: config.streaming,
          session_id: execCtx.sessionId,
          user_id: execCtx.userId,
          conversation_id: config.conversationId,
          ...config.kwargs,
        },
        initialState: config.initialState,
        runTimeoutSeconds: config.runTimeoutSeconds,
      }));

      // Delegate to batchInvoke
      return this.batchInvoke(key, workflows);
    },

    async batchAgentInvokeAndWait<T>(key: string, configs: AgentRunConfig[]): Promise<T[]> {
      checkAborted();

      const workflows: BatchWorkflowInput[] = configs.map((config) => ({
        workflow: config.agent,
        payload: {
          input: config.input,
          streaming: config.streaming,
          session_id: execCtx.sessionId,
          user_id: execCtx.userId,
          conversation_id: config.conversationId,
          ...config.kwargs,
        },
        initialState: config.initialState,
        runTimeoutSeconds: config.runTimeoutSeconds,
      }));

      // Delegate to batchInvokeAndWait
      return this.batchInvokeAndWait<T>(key, workflows);
    },

    async trace<T>(
      name: string,
      fn: (span: unknown) => Promise<T>,
      attributes?: Record<string, string | number | boolean>
    ): Promise<T> {
      const tracer = getTracer();
      if (!tracer) return fn(undefined);

      const execContextData = getExecutionContext();
      const parentContext = getParentSpanContextFromExecutionContext(execContextData);
      const spanOpts = attributes ? { attributes } : {};
      const span = tracer.startSpan(name, spanOpts, parentContext);

      const oldSpanContext = getSpanContextFromExecutionContext(execContextData);
      setSpanContextInExecutionContext(execContextData, span.spanContext());

      try {
        const result = await fn(span);
        span.setStatus({ code: 1 /* OK */ });
        return result;
      } catch (e) {
        span.setStatus({ code: 2 /* ERROR */, message: String(e) });
        if (e instanceof Error) {
          span.recordException(e);
        }
        throw e;
      } finally {
        setSpanContextInExecutionContext(execContextData, oldSpanContext);
        span.end();
      }
    },
  };
}

/**
 * Execute a workflow.
 *
 * 1. Loads cached step outputs for replay
 * 2. Initializes state
 * 3. Sets up tracing context
 * 4. Publishes start event
 * 5. Executes onStart hooks
 * 6. Calls the workflow handler
 * 7. Executes onEnd hooks
 * 8. Publishes finish event
 * 9. Returns (result, finalState)
 */
export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<ExecutionResult> {
  const { workflow, payload, context, orchestratorClient, workerId, abortSignal } = options;

  let state: Record<string, unknown> = {};
  let validatedPayload = payload;

  // Determine workflow type from config (default: "workflow")
  const workflowType = workflow.config.workflowType ?? 'workflow';

  try {
    // Load cached step outputs for replay
    const cachedSteps = new Map<string, StepOutput>();
    try {
      const stepOutputs = await orchestratorClient.getAllStepOutputs(context.executionId, workerId);
      for (const output of stepOutputs) {
        cachedSteps.set(output.stepKey, output);
      }
      if (stepOutputs.length > 0) {
        logger.info(`Loaded ${String(stepOutputs.length)} cached step outputs for replay`);
      }
    } catch (err) {
      logger.warn('Failed to load cached step outputs', { error: String(err) });
    }

    // Initialize state
    if (context.initialState) {
      state = context.initialState;
    } else if (workflow.stateSchema) {
      state = initializeState(
        workflow.stateSchema as ZodSchema<Record<string, unknown>, ZodTypeDef, unknown>
      );
    }

    // Validate payload if schema provided
    if (workflow.payloadSchema) {
      validatedPayload = validateState(payload, workflow.payloadSchema);
    }

    // Compute effective root IDs
    const rootExecutionId = context.rootExecutionId ?? context.executionId;
    const rootWorkflowId = context.rootWorkflowId ?? workflow.id;

    // Create step helper
    const step = createOrchestratorStepHelper(
      orchestratorClient,
      cachedSteps,
      {
        workflowId: workflow.id,
        executionId: context.executionId,
        deploymentId: context.deploymentId,
        sessionId: context.sessionId,
        userId: context.userId,
        rootExecutionId,
        rootWorkflowId,
        otelTraceparent: context.otelTraceparent,
      },
      workerId,
      abortSignal
    );

    // Create workflow context
    let ctx: WorkflowContext<Record<string, unknown>>;

    if (workflowType === 'agent') {
      // Build AgentContext for agents
      const agentWf = workflow as AgentWorkflow;
      const conversationId =
        typeof validatedPayload === 'object' && validatedPayload !== null
          ? ((validatedPayload as Record<string, unknown>)['conversation_id'] as string | undefined)
          : undefined;

      const agentCtx: AgentContext<Record<string, unknown>> = {
        workflowId: workflow.id,
        executionId: context.executionId,
        deploymentId: context.deploymentId,
        sessionId: context.sessionId,
        userId: context.userId,
        parentExecutionId: context.parentExecutionId,
        rootExecutionId,
        rootWorkflowId,
        retryCount: context.retryCount,
        createdAt: context.createdAt,
        workflowType,
        otelTraceparent: context.otelTraceparent,
        otelSpanId: context.otelSpanId,
        state,
        step,
        agentId: workflow.id,
        model: getModelId(agentWf.llm.model),
        provider: getModelProvider(agentWf.llm.model),
        systemPrompt: agentWf.agentConfig.systemPrompt,
        tools: agentWf.tools,
        temperature: agentWf.agentConfig.temperature,
        maxTokens: agentWf.agentConfig.maxOutputTokens,
        conversationId,
      };
      ctx = agentCtx;
    } else {
      // WorkflowContext for regular workflows and tools
      ctx = {
        workflowId: workflow.id,
        executionId: context.executionId,
        deploymentId: context.deploymentId,
        sessionId: context.sessionId,
        userId: context.userId,
        parentExecutionId: context.parentExecutionId,
        rootExecutionId,
        rootWorkflowId,
        retryCount: context.retryCount,
        createdAt: context.createdAt,
        workflowType,
        otelTraceparent: context.otelTraceparent,
        otelSpanId: context.otelSpanId,
        state,
        step,
      };
    }

    // --- Set up OpenTelemetry tracing ---
    const tracer = getTracer();
    let span: Span | undefined;
    const isRootWorkflow = !context.parentExecutionId;

    if (tracer) {
      const spanName = `${workflowType}.${workflow.id}`;

      // Build span attributes
      const spanAttributes: Record<string, string | number> = {
        [`${workflowType}.id`]: workflow.id,
        [`${workflowType}.execution_id`]: context.executionId,
        [`${workflowType}.root_execution_id`]: rootExecutionId,
        [`${workflowType}.deployment_id`]: context.deploymentId,
        [`${workflowType}.type`]: workflowType,
        [`${workflowType}.retry_count`]: context.retryCount,
      };
      if (context.parentExecutionId) {
        spanAttributes[`${workflowType}.parent_execution_id`] = context.parentExecutionId;
      }
      if (context.sessionId) {
        spanAttributes[`${workflowType}.session_id`] = context.sessionId;
      }
      if (context.userId) {
        spanAttributes[`${workflowType}.user_id`] = context.userId;
      }
      if (context.otelSpanId) {
        spanAttributes[`${workflowType}.previous_span_id`] = context.otelSpanId;
      }

      // Determine parent context
      let otelParentContext: Context | undefined;
      if (context.otelTraceparent) {
        // Sub-workflow: extract parent from traceparent
        otelParentContext = createContextFromTraceparent(context.otelTraceparent);
      } else {
        // Root workflow: deterministic trace ID
        const traceIdHex = generateTraceIdFromExecutionId(rootExecutionId);
        otelParentContext = createContextWithTraceId(traceIdHex);
      }

      // For root workflows, activate context so IdGenerator reads trace ID
      if (isRootWorkflow && otelParentContext) {
        // Use context.with to make the deterministic trace ID available
        span = otelContext.with(otelParentContext, () => {
          return tracer.startSpan(spanName, { attributes: spanAttributes }, otelParentContext);
        });
      } else {
        span = tracer.startSpan(spanName, { attributes: spanAttributes }, otelParentContext);
      }
    }

    // Topic for workflow events
    const topic = `workflow/${ctx.rootWorkflowId}/${ctx.rootExecutionId}`;

    // Set input and initial state on span
    if (span) {
      try {
        span.setAttribute(`${workflowType}.input`, JSON.stringify(validatedPayload));
      } catch {
        /* ignore */
      }
      try {
        span.setAttribute(`${workflowType}.initial_state`, JSON.stringify(state));
      } catch {
        /* ignore */
      }

      // Add resumed event if this is a resumed workflow
      if (context.otelSpanId) {
        span.addEvent(`${workflowType}.resumed`);
      }
    }

    // Build execution context data with span context so hooks and handler
    // can create properly-parented OTel spans via getExecutionContext().
    const spanCtx = span?.spanContext();
    const execContextData = {
      executionId: context.executionId,
      workflowId: workflow.id,
      orchestratorClient,
      _otelSpanContext: spanCtx,
      _otelTraceId: spanCtx?.traceId,
      _otelSpanId: spanCtx?.spanId,
    };

    try {
      // Run everything (hooks + handler) within execution context so that
      // ctx.step.run() inside hooks creates spans with the correct trace ID.
      return await runInExecutionContext(execContextData, async () => {
        // Publish start event
        await step.publishEvent('publish_start', {
          topic,
          type: `${workflowType}_start`,
          data: {
            payload: validatedPayload,
            _metadata: {
              execution_id: ctx.executionId,
              workflow_id: ctx.workflowId,
            },
          },
        });

        // Execute onStart hooks
        if (workflow.config.onStart) {
          const hookResult = await executeHookChain(normalizeHooks(workflow.config.onStart), {
            ctx,
            hookName: 'on_start',
            payload: validatedPayload,
            phase: 'onStart',
          });

          if (!hookResult.success) {
            if (span) {
              span.setStatus({
                code: 2 /* ERROR */,
                message: hookResult.error ?? 'onStart hook failed',
              });
              span.setAttribute(`${workflowType}.status`, 'failed');
            }
            return {
              success: false,
              error: hookResult.error ?? 'onStart hook failed',
              retryable: false,
              finalState: state,
            };
          }

          // Apply modified payload
          validatedPayload = hookResult.payload;
        }

        // Check for cancellation
        if (abortSignal?.aborted) {
          if (span) {
            span.setStatus({ code: 2 /* ERROR */, message: 'Execution cancelled' });
            span.setAttribute(`${workflowType}.status`, 'cancelled');
          }
          return {
            success: false,
            error: 'Execution cancelled',
            retryable: false,
            finalState: state,
          };
        }

        // Execute workflow handler
        const result = await workflow.handler(ctx, validatedPayload);

        // Extract final state
        if (workflow.stateSchema) {
          state = validateState(
            ctx.state,
            workflow.stateSchema as ZodSchema<Record<string, unknown>, ZodTypeDef, unknown>
          );
        } else {
          state = ctx.state;
        }

        // Execute onEnd hooks
        let finalResult: unknown = result;
        if (workflow.config.onEnd) {
          const hookResult = await executeHookChain(normalizeHooks(workflow.config.onEnd), {
            ctx,
            hookName: 'on_end',
            payload: validatedPayload,
            output: result,
            phase: 'onEnd',
          });

          if (!hookResult.success) {
            if (span) {
              span.setStatus({
                code: 2 /* ERROR */,
                message: hookResult.error ?? 'onEnd hook failed',
              });
              span.setAttribute(`${workflowType}.status`, 'failed');
            }
            return {
              success: false,
              error: hookResult.error ?? 'onEnd hook failed',
              retryable: false,
              finalState: state,
            };
          }

          // Apply modified output
          if (hookResult.output !== undefined) {
            finalResult = hookResult.output;
          }
        }

        // Publish finish event
        await step.publishEvent('publish_finish', {
          topic,
          type: `${workflowType}_finish`,
          data: {
            result: finalResult,
            _metadata: {
              execution_id: ctx.executionId,
              workflow_id: ctx.workflowId,
            },
          },
        });

        // Success span attributes
        if (span) {
          span.setStatus({ code: 1 /* OK */ });
          span.setAttribute(`${workflowType}.status`, 'completed');
          try {
            span.setAttribute(`${workflowType}.output`, JSON.stringify(finalResult));
          } catch {
            /* ignore */
          }
          try {
            const resultStr = JSON.stringify(finalResult);
            span.setAttribute(`${workflowType}.result_size`, resultStr.length);
          } catch {
            /* ignore */
          }
          try {
            span.setAttribute(`${workflowType}.final_state`, JSON.stringify(state));
          } catch {
            /* ignore */
          }
        }

        return {
          success: true,
          result: finalResult,
          finalState: state,
        };
      }); // end runInExecutionContext
    } catch (error) {
      // WaitError — execution is paused, not a failure
      if (isWaitError(error)) {
        if (span) {
          span.setStatus({ code: 1 /* OK */ });
          span.setAttribute(`${workflowType}.status`, 'waiting');
          span.addEvent(`${workflowType}.waiting`, { reason: error.message });

          // Save span ID for resume linkage
          const spanContext = span.spanContext();
          if (spanContext.spanId) {
            try {
              await orchestratorClient.updateExecutionOtelSpanId(
                context.executionId,
                spanContext.spanId
              );
            } catch (e) {
              logger.warn(`Failed to update otel_span_id: ${String(e)}`);
            }
          }
        }

        return {
          success: false,
          waiting: true,
          error: error.message,
          retryable: false,
          finalState: state,
        };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      // Check if cancelled
      if (errorMessage === 'Execution cancelled' || abortSignal?.aborted) {
        if (span) {
          span.setStatus({ code: 2 /* ERROR */, message: 'Execution cancelled' });
          span.setAttribute(`${workflowType}.status`, 'cancelled');
        }
        return {
          success: false,
          error: 'Execution cancelled',
          retryable: false,
          finalState: state,
        };
      }

      logger.error(`${workflowType} '${workflow.id}' execution failed: ${errorMessage}`, {
        workflowId: workflow.id,
        executionId: context.executionId,
        workflowType,
        error: errorMessage,
        stack,
      });

      // Error span attributes
      if (span) {
        span.setStatus({ code: 2 /* ERROR */, message: errorMessage });
        if (error instanceof Error) {
          span.recordException(error);
        }
        span.setAttribute(`${workflowType}.status`, 'failed');
        try {
          span.setAttribute(
            `${workflowType}.error`,
            JSON.stringify({ message: errorMessage, stack })
          );
        } catch {
          /* ignore */
        }
      }

      // StepExecutionError and "tool" workflows are not retryable
      const retryable =
        !(error instanceof StepExecutionError) && workflow.config.workflowType !== 'tool';

      return {
        success: false,
        error: errorMessage,
        stack,
        retryable,
        finalState: state,
      };
    } finally {
      if (span) {
        span.end();
      }
    }
  } catch (error) {
    // Outer catch for errors before span creation (step loading, state init, etc.)
    if (isWaitError(error)) {
      return {
        success: false,
        waiting: true,
        error: error.message,
        retryable: false,
        finalState: state,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    if (errorMessage === 'Execution cancelled' || abortSignal?.aborted) {
      return {
        success: false,
        error: 'Execution cancelled',
        retryable: false,
        finalState: state,
      };
    }

    logger.error(
      `${workflow.config.workflowType ?? 'workflow'} '${workflow.id}' execution failed: ${errorMessage}`,
      {
        workflowId: workflow.id,
        executionId: context.executionId,
        workflowType: workflow.config.workflowType ?? 'workflow',
        error: errorMessage,
        stack,
      }
    );

    const retryable =
      !(error instanceof StepExecutionError) && workflow.config.workflowType !== 'tool';

    return {
      success: false,
      error: errorMessage,
      stack,
      retryable,
      finalState: state,
    };
  }
}

/**
 * Serialize the final state for persistence.
 */
export function serializeFinalState(state: Record<string, unknown>): string {
  return serializeState(state);
}
