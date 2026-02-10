/**
 * LLM module — wraps Vercel AI SDK for Python-compatible generation and streaming.
 */

export { LLM } from './llm.js';
export { llmGenerate } from './generate.js';
export { llmStream, type PublishEventFn } from './stream.js';
export type {
  LLMUsage,
  LLMToolCall,
  LLMToolResult,
  LLMResponse,
  LLMStreamEvent,
  LLMGenerateOptions,
  LLMGeneratePayload,
  LLMGenerateResult,
  LLMStreamPayload,
} from './types.js';
export {
  convertToolsToVercel,
  convertToolResultsToMessages,
  convertVercelToolCallToPython,
  convertPythonToolCallToMiddleware,
  convertMiddlewareToolCallToPython,
  convertVercelUsageToPython,
  convertFinishReason,
} from './types.js';
