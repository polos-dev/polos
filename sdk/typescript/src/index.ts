/**
 * Polos SDK for building durable AI agents and workflows in TypeScript.
 *
 * @packageDocumentation
 */

// Client
export {
  PolosClient,
  type PolosClientConfig,
  type ClientInvokeOptions,
  type ClientBatchWorkflowInput,
  type EventsApi,
  type SchedulesApi,
  type SchedulePayload,
} from './client.js';

// Execution Handle
export { ExecutionHandle, type ExecutionHandleFields } from './execution-handle.js';

// Core - Workflow definition
export {
  defineWorkflow,
  type Workflow,
  type WorkflowConfig,
  type WorkflowHandler,
  type WorkflowHandle,
  type WorkflowStatus,
  type QueueConfig,
  type ScheduleConfig,
  type WorkflowRunClient,
  type WorkflowRunOptions,
  type InferPayload,
  type InferState,
  type InferResult,
} from './core/workflow.js';

// Core - Tool definition
export {
  defineTool,
  isToolWorkflow,
  type ToolWorkflow,
  type DefineToolConfig,
  type LlmToolDefinition,
  type ToolApproval,
} from './core/tool.js';

// Hooks (single source of truth: middleware/hook.ts, re-exported via core/workflow.ts)
export {
  defineHook,
  HookResult,
  isHook,
  normalizeHook,
  normalizeHooks,
  type Hook,
  type HookHandler,
  type HookContext,
  type HookResultType,
  type DefineHookOptions,
} from './core/workflow.js';

export type { WorkflowContext, AgentContext } from './core/context.js';

// Core - Step helper
export {
  StepExecutionError,
  WaitError,
  isWaitError,
  createStepHelper,
  createStepStore,
  type StepHelper,
  type StepOptions,
  type InvokeOptions,
  type WaitForOptions,
  type WaitForEventOptions,
  type PublishEventOptions,
  type SuspendOptions,
  type ResumeOptions,
  type BatchWorkflowInput,
  type BatchStepResult,
  AgentRunConfig,
  type StepStore,
} from './core/step.js';

// Core - State management
export {
  StateValidationError,
  StateSizeError,
  initializeState,
  validateState,
} from './core/state.js';

// Core - Registry
export {
  globalRegistry,
  createWorkflowRegistry,
  WorkflowNotFoundError,
  DuplicateWorkflowError,
  type WorkflowRegistry,
} from './core/registry.js';

// Runtime - Queue
export { Queue, type QueueOptions } from './runtime/queue.js';

// Runtime - Worker
export {
  Worker,
  type WorkerConfig,
  WorkerServer,
  type WorkerServerConfig,
  type WorkerExecutionData,
  OrchestratorClient,
  OrchestratorApiError,
  type OrchestratorClientConfig,
  executeWorkflow,
  serializeFinalState,
  type ExecuteWorkflowOptions,
  type ExecutionResult,
  type ExecutionContext,
  type ExecutionData,
  batchInvoke,
  batchAgentInvoke,
} from './runtime/index.js';

// Middleware - Hook execution
export {
  HookExecutionError,
  type HookChainResult,
  type ExecuteHooksOptions,
  executeHookChain,
  executeHooksOrThrow,
  composeHooks,
  conditionalHook,
} from './middleware/index.js';

// Middleware - Guardrails
export {
  type GuardrailContext as MiddlewareGuardrailContext,
  type GuardrailResultType,
  type GuardrailHandler,
  type Guardrail as MiddlewareGuardrail,
  type DefineGuardrailOptions,
  GuardrailResult as MiddlewareGuardrailResult,
  defineGuardrail,
  isGuardrail,
  normalizeGuardrail,
  normalizeGuardrails,
  GuardrailError,
  type GuardrailChainResult,
  type ExecuteGuardrailsOptions,
  executeGuardrailChain,
  executeGuardrailsOrThrow,
  composeGuardrails,
} from './middleware/index.js';

// Agents
export {
  defineAgent,
  isAgentWorkflow,
  agentStreamFunction,
  StreamResult,
  stopCondition,
  maxTokens,
  maxSteps,
  executedTool,
  hasText,
  type AgentWorkflow,
  type DefineAgentConfig,
  type AgentRunPayload,
  type AgentStreamPayload,
  type AgentStreamResult,
  type StopCondition,
  type StopConditionContext,
  type StepInfo,
  type ToolResultInfo,
} from './agents/index.js';

// Types - Agent (client-side types)
export type {
  Tool,
  ToolHandler,
  ToolConfig,
  Guardrail,
  GuardrailContext,
  AgentConfig,
  AgentResult,
  AgentStep,
  Agent,
  AgentRunOptions,
  AgentStream,
  AgentStreamEvent,
} from './types/agent.js';

export { GuardrailResult } from './types/agent.js';

// Types - LLM
export type {
  LanguageModel,
  CoreMessage,
  TokenUsage,
  FinishReason,
  ToolCall,
  ToolResult,
  GenerateConfig,
  LLMProvider,
} from './types/llm.js';

// LLM module
export {
  LLM,
  llmGenerate,
  llmStream,
  type LLMUsage,
  type LLMToolCall,
  type LLMToolResult,
  type LLMResponse,
  type LLMStreamEvent,
  type LLMGenerateOptions,
  type LLMGeneratePayload,
  type LLMGenerateResult,
  type LLMStreamPayload,
  type PublishEventFn,
  convertToolsToVercel,
  convertToolResultsToMessages,
  convertVercelToolCallToPython,
  convertPythonToolCallToMiddleware,
  convertMiddlewareToolCallToPython,
  convertVercelUsageToPython,
  convertFinishReason,
} from './llm/index.js';

// Types - Events
export type {
  EventData,
  EventPayload,
  EventItem,
  BatchEventPayload,
  Event,
  StreamEvent,
  StreamTopicOptions,
  StreamWorkflowOptions,
  EventTriggerPayload,
  WorkflowEvent,
  TextDeltaEvent,
  ToolCallEvent,
} from './types/events.js';

// Utilities
export { retry, sleep, createLogger, type Logger } from './utils/index.js';

// Features - Tracing
export {
  initializeOtel,
  getTracer,
  extractTraceparent,
  generateTraceIdFromExecutionId,
  isOtelAvailable,
  type OtelConfig,
} from './features/index.js';

// Tools - Ask user
export { createAskUserTool } from './tools/ask-user.js';

// Tools - Web search
export {
  createWebSearchTool,
  type WebSearchToolConfig,
  type WebSearchResult,
  type WebSearchResultItem,
  type WebSearchOptions,
  type WebSearchFunction,
  type TavilySearchConfig,
} from './tools/web-search.js';

// Execution - Sandbox tools
export {
  sandboxTools,
  type SandboxToolsResult,
  DockerEnvironment,
  evaluateAllowlist,
  assertSafePath,
  truncateOutput,
  isBinary,
  parseGrepOutput,
  stripAnsi,
  createExecTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  type ExecutionEnvironment,
  type ExecOptions,
  type ExecResult,
  type GlobOptions,
  type GrepOptions,
  type GrepMatch,
  type EnvironmentInfo,
  type DockerEnvironmentConfig,
  type E2BEnvironmentConfig,
  type LocalEnvironmentConfig,
  type ExecToolConfig,
  type SandboxToolsConfig,
} from './execution/index.js';
