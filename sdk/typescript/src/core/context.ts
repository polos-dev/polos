/**
 * WorkflowContext implementation.
 *
 * Provides the execution context for workflows including state access,
 * step execution, and metadata about the current execution.
 */

import type { StepHelper } from './step.js';

/**
 * Context available during workflow execution.
 */
export interface WorkflowContext<TState = unknown> {
  /** Workflow identifier */
  readonly workflowId: string;
  /** Unique execution identifier */
  readonly executionId: string;
  /** Deployment identifier */
  readonly deploymentId: string;
  /** Session identifier (if provided) */
  readonly sessionId?: string | undefined;
  /** User identifier (if provided) */
  readonly userId?: string | undefined;
  /** Parent execution identifier (if this is a sub-workflow) */
  readonly parentExecutionId?: string | undefined;
  /** Root execution identifier (top-level execution in the hierarchy) */
  readonly rootExecutionId: string;
  /** Root workflow identifier (top-level workflow in the hierarchy) */
  readonly rootWorkflowId: string;
  /** Number of times this execution has been retried */
  readonly retryCount: number;
  /** When the execution was created (ISO 8601 string) */
  readonly createdAt?: string | undefined;
  /** Workflow type: "workflow", "agent", or "tool" */
  readonly workflowType?: string | undefined;
  /** OpenTelemetry trace parent */
  readonly otelTraceparent?: string | undefined;
  /** OpenTelemetry span ID */
  readonly otelSpanId?: string | undefined;
  /** Workflow state (persisted across executions) */
  state: TState;
  /** Step helper for durable operations */
  readonly step: StepHelper;
}

/**
 * Context for agent execution — extends WorkflowContext with agent-specific fields.
 * Matches Python AgentContext(WorkflowContext).
 */
export interface AgentContext<TState = unknown> extends WorkflowContext<TState> {
  /** Agent identifier (same as workflowId) */
  readonly agentId: string;
  /** LLM model identifier */
  readonly model: string;
  /** LLM provider identifier */
  readonly provider: string;
  /** System prompt */
  readonly systemPrompt?: string | undefined;
  /** Tools available to the agent */
  readonly tools: unknown[];
  /** Temperature for LLM generation */
  readonly temperature?: number | undefined;
  /** Maximum output tokens */
  readonly maxTokens?: number | undefined;
  /** Conversation ID (mutable — set by agent handler, matching Python) */
  conversationId?: string | undefined;
}

/**
 * Internal context data used during workflow execution.
 */
export interface WorkflowContextData<TState = unknown> {
  workflowId: string;
  executionId: string;
  deploymentId: string;
  sessionId?: string | undefined;
  userId?: string | undefined;
  parentExecutionId?: string | undefined;
  rootExecutionId: string;
  rootWorkflowId: string;
  retryCount: number;
  createdAt?: string | undefined;
  workflowType?: string | undefined;
  otelTraceparent?: string | undefined;
  otelSpanId?: string | undefined;
  state: TState;
}

/**
 * Options for creating a workflow context.
 */
export interface CreateContextOptions<TState> {
  /** Workflow identifier */
  workflowId: string;
  /** Execution identifier (generated if not provided) */
  executionId?: string | undefined;
  /** Deployment identifier */
  deploymentId: string;
  /** Session identifier */
  sessionId?: string | undefined;
  /** User identifier */
  userId?: string | undefined;
  /** Parent execution identifier */
  parentExecutionId?: string | undefined;
  /** Root execution identifier (defaults to executionId) */
  rootExecutionId?: string | undefined;
  /** Root workflow identifier (defaults to workflowId) */
  rootWorkflowId?: string | undefined;
  /** Retry count */
  retryCount?: number | undefined;
  /** When the execution was created */
  createdAt?: string | undefined;
  /** Workflow type: "workflow", "agent", or "tool" */
  workflowType?: string | undefined;
  /** OpenTelemetry trace parent */
  otelTraceparent?: string | undefined;
  /** OpenTelemetry span ID */
  otelSpanId?: string | undefined;
  /** Initial state */
  initialState: TState;
  /** Step helper instance */
  stepHelper: StepHelper;
}

/**
 * Create a workflow context.
 */
export function createWorkflowContext<TState>(
  options: CreateContextOptions<TState>
): WorkflowContext<TState> {
  const executionId = options.executionId ?? crypto.randomUUID();

  const context: WorkflowContext<TState> = {
    workflowId: options.workflowId,
    executionId,
    deploymentId: options.deploymentId,
    sessionId: options.sessionId,
    userId: options.userId,
    parentExecutionId: options.parentExecutionId,
    rootExecutionId: options.rootExecutionId ?? executionId,
    rootWorkflowId: options.rootWorkflowId ?? options.workflowId,
    retryCount: options.retryCount ?? 0,
    createdAt: options.createdAt,
    workflowType: options.workflowType ?? 'workflow',
    otelTraceparent: options.otelTraceparent,
    otelSpanId: options.otelSpanId,
    state: options.initialState,
    step: options.stepHelper,
  };

  return context;
}

/**
 * Extract context data for serialization.
 */
export function extractContextData<TState>(
  ctx: WorkflowContext<TState>
): WorkflowContextData<TState> {
  return {
    workflowId: ctx.workflowId,
    executionId: ctx.executionId,
    deploymentId: ctx.deploymentId,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    parentExecutionId: ctx.parentExecutionId,
    rootExecutionId: ctx.rootExecutionId,
    rootWorkflowId: ctx.rootWorkflowId,
    retryCount: ctx.retryCount,
    createdAt: ctx.createdAt,
    workflowType: ctx.workflowType,
    otelTraceparent: ctx.otelTraceparent,
    otelSpanId: ctx.otelSpanId,
    state: ctx.state,
  };
}
