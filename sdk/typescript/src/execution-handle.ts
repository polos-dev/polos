/**
 * ExecutionHandle - Represents a workflow execution that can be monitored and managed.
 *
 * Mirrors Python's ExecutionHandle class. Unlike Python (where get/cancel take a client arg),
 * the TS version stores the OrchestratorClient internally for a cleaner API.
 */

import type { OrchestratorClient } from './runtime/orchestrator-client.js';
import type { GetExecutionResponse } from './runtime/orchestrator-types.js';

/**
 * Fields used to construct an ExecutionHandle.
 */
export interface ExecutionHandleFields {
  id: string;
  workflowId: string;
  createdAt?: string | undefined;
  parentExecutionId?: string | undefined;
  rootWorkflowId: string;
  rootExecutionId: string;
  sessionId?: string | undefined;
  userId?: string | undefined;
  stepKey?: string | undefined;
}

/**
 * Handle for a workflow execution that allows monitoring and management.
 */
export class ExecutionHandle {
  /** Execution ID */
  readonly id: string;
  /** Workflow ID */
  readonly workflowId: string;
  /** When the execution was created */
  readonly createdAt: string | undefined;
  /** Parent execution ID (if invoked from another workflow) */
  readonly parentExecutionId: string | undefined;
  /** Root workflow ID */
  readonly rootWorkflowId: string;
  /** Root execution ID */
  readonly rootExecutionId: string;
  /** Session ID */
  readonly sessionId: string | undefined;
  /** User ID */
  readonly userId: string | undefined;
  /** Step key (if invoked from a step) */
  readonly stepKey: string | undefined;

  private readonly orchestratorClient: OrchestratorClient;

  constructor(fields: ExecutionHandleFields, orchestratorClient: OrchestratorClient) {
    this.id = fields.id;
    this.workflowId = fields.workflowId;
    this.createdAt = fields.createdAt;
    this.parentExecutionId = fields.parentExecutionId;
    this.rootWorkflowId = fields.rootWorkflowId;
    this.rootExecutionId = fields.rootExecutionId;
    this.sessionId = fields.sessionId;
    this.userId = fields.userId;
    this.stepKey = fields.stepKey;
    this.orchestratorClient = orchestratorClient;
  }

  /**
   * Get the current execution status and details.
   */
  async get(): Promise<GetExecutionResponse> {
    return this.orchestratorClient.getExecution(this.id);
  }

  /**
   * Cancel the execution if it's still queued or running.
   *
   * @returns true if cancellation was successful, false on error
   */
  async cancel(): Promise<boolean> {
    try {
      await this.orchestratorClient.cancelExecution(this.id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Poll until the execution completes and return the result.
   * Matches Python ExecutionHandle.get_result().
   *
   * @param timeout - Maximum time to wait in seconds (default: 600)
   * @returns The execution result
   * @throws Error if execution fails, is cancelled, or times out
   */
  async getResult(timeout = 600): Promise<unknown> {
    const startTime = Date.now();
    const pollInterval = 500;
    let done = false;
    while (!done) {
      const exec = await this.get();
      if (exec.status === 'completed') return exec.result;
      if (exec.status === 'failed') throw new Error(exec.error ?? 'Execution failed');
      if (exec.status === 'cancelled') throw new Error('Execution cancelled');
      if (Date.now() - startTime > timeout * 1000) {
        done = true;
      } else {
        await new Promise((r) => setTimeout(r, pollInterval));
      }
    }
    throw new Error(`Timed out after ${String(timeout)}s`);
  }

  /**
   * Convert the handle to a plain object (excluding undefined fields).
   */
  toDict(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      id: this.id,
      workflowId: this.workflowId,
      rootWorkflowId: this.rootWorkflowId,
      rootExecutionId: this.rootExecutionId,
    };
    if (this.createdAt !== undefined) result['createdAt'] = this.createdAt;
    if (this.parentExecutionId !== undefined) result['parentExecutionId'] = this.parentExecutionId;
    if (this.sessionId !== undefined) result['sessionId'] = this.sessionId;
    if (this.userId !== undefined) result['userId'] = this.userId;
    if (this.stepKey !== undefined) result['stepKey'] = this.stepKey;
    return result;
  }
}
