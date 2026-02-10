/**
 * Execution context tracking using AsyncLocalStorage.
 *
 * Matches Python's _execution_context ContextVar in core/workflow.py.
 * Used to detect when code is running inside a workflow execution,
 * so that PolosClient methods can throw if misused from within a workflow.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrchestratorClient } from './orchestrator-client.js';

/**
 * Data stored in the execution context.
 */
export interface ExecutionContextData {
  executionId: string;
  workflowId: string;
  /** Orchestrator client — needed by agents for conversation history. */
  orchestratorClient?: OrchestratorClient | undefined;
  /** OTel span context from current span (typed as unknown since @opentelemetry/api is optional). */
  _otelSpanContext?: unknown;
  /** Hex trace ID for the current span. */
  _otelTraceId?: string | undefined;
  /** Hex span ID for the current span. */
  _otelSpanId?: string | undefined;
}

/**
 * AsyncLocalStorage instance for tracking whether we're inside a workflow execution.
 * Matches Python's `_execution_context: ContextVar[dict | None]`.
 */
const executionContextStorage = new AsyncLocalStorage<ExecutionContextData>();

/**
 * Run a function within an execution context.
 * Used by the executor to mark that workflow handler code is running.
 */
export function runInExecutionContext<T>(data: ExecutionContextData, fn: () => T): T {
  return executionContextStorage.run(data, fn);
}

/**
 * Check if we're currently inside a workflow execution.
 * Returns the context data if inside, undefined otherwise.
 */
export function getExecutionContext(): ExecutionContextData | undefined {
  return executionContextStorage.getStore();
}

/**
 * Assert that we're NOT inside a workflow execution.
 * Throws RuntimeError if called from within a workflow handler.
 *
 * Matches Python's pattern:
 *   if _execution_context.get() is not None:
 *       raise RuntimeError("... cannot be called from within a workflow ...")
 */
export function assertNotInExecutionContext(methodName: string, alternative: string): void {
  const ctx = getExecutionContext();
  if (ctx !== undefined) {
    throw new Error(
      `${methodName} cannot be called from within a workflow or agent. ` +
        `Use ${alternative} to call workflows from within workflows.`
    );
  }
}
