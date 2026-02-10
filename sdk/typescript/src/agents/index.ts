/**
 * Agents module — defines agents that run LLMs in a loop with tool execution.
 */

export {
  defineAgent,
  isAgentWorkflow,
  type AgentWorkflow,
  type DefineAgentConfig,
  type AgentRunPayload,
} from './agent.js';
export { StreamResult } from './stream-result.js';
export { agentStreamFunction, type AgentStreamPayload, type AgentStreamResult } from './stream.js';
export {
  stopCondition,
  maxTokens,
  maxSteps,
  executedTool,
  hasText,
  type StopCondition,
  type StopConditionContext,
  type StepInfo,
  type ToolResultInfo,
} from './stop-conditions.js';
