/**
 * Workflow-related type definitions.
 *
 * Re-exports core types and adds additional type utilities.
 */

// Re-export all workflow types from core
export type {
  QueueConfig,
  ScheduleConfig,
  WorkflowConfig,
  WorkflowHandler,
  WorkflowHandle,
  WorkflowStatus,
  Workflow,
  InferPayload,
  InferState,
  InferResult,
} from '../core/workflow.js';

// Hook types (re-exported from middleware via core/workflow.ts)
export type {
  Hook,
  HookHandler,
  HookContext,
  HookResultType,
  DefineHookOptions,
} from '../core/workflow.js';

// HookResult is both a type and a value - export value only (type inferred)
export { HookResult } from '../core/workflow.js';

// Re-export context types
export type { WorkflowContext } from '../core/context.js';

// Re-export step types
export type {
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

// Re-export step error
export { StepExecutionError, WaitError, isWaitError } from '../core/step.js';

// Tool types
export type { ToolWorkflow, DefineToolConfig, LlmToolDefinition } from '../core/tool.js';
