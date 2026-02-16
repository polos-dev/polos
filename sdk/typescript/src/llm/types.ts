/**
 * LLM types and conversion utilities.
 *
 * All wire-format types use snake_case to match Python for cross-language compatibility.
 */

import type { ModelMessage as CoreMessage, LanguageModel } from 'ai';
import { jsonSchema } from 'ai';
import type { LlmToolDefinition } from '../core/tool.js';
import type { ToolCall } from '../types/llm.js';
import type { Guardrail } from '../middleware/guardrail.js';

/**
 * Extract modelId from a LanguageModel (which may be a string or model object).
 */
export function getModelId(model: LanguageModel): string {
  return typeof model === 'string' ? model : model.modelId;
}

/**
 * Extract provider from a LanguageModel (which may be a string or model object).
 */
export function getModelProvider(model: LanguageModel): string {
  if (typeof model === 'string') {
    // For string model IDs like "anthropic/claude-3", extract provider prefix
    const slashIdx = model.indexOf('/');
    return slashIdx >= 0 ? model.slice(0, slashIdx) : 'unknown';
  }
  return model.provider;
}

// ── Wire-format types ────────────────────────

/**
 * Token usage statistics
 */
export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_input_tokens?: number | undefined;
  cache_creation_input_tokens?: number | undefined;
}

/**
 * A tool call made by the LLM
 */
export interface LLMToolCall {
  id: string;
  type: 'function';
  call_id: string;
  function: { name: string; arguments: string };
}

/**
 * Result from a tool execution
 */
export interface LLMToolResult {
  type: 'function_call_output';
  call_id: string;
  name: string;
  output: unknown;
}

/**
 * Response from a non-streaming LLM generation
 */
export interface LLMResponse {
  content: string | null;
  usage: LLMUsage | null;
  tool_calls: LLMToolCall[] | null;
  raw_output: unknown[] | null;
  model: string | null;
  stop_reason: string | null;
}

/**
 * Stream event types (matching Python exactly).
 */
export type LLMStreamEvent =
  | { type: 'text_delta'; data: { content: string } }
  | { type: 'tool_call'; data: { tool_call: LLMToolCall } }
  | {
      type: 'done';
      data: { usage: LLMUsage; raw_output: unknown[]; model: string; stop_reason: string | null };
    }
  | { type: 'error'; data: { error: string } };

/**
 * Options for LLM.generate() and LLM.stream().
 */
export interface LLMGenerateOptions {
  /** Conversation messages */
  messages: CoreMessage[];
  /** System prompt */
  system?: string | undefined;
  /** Tools available to the LLM */
  tools?: LlmToolDefinition[] | undefined;
  /** Tool results from previous tool calls */
  tool_results?: LLMToolResult[] | undefined;
  /** Temperature for randomness */
  temperature?: number | undefined;
  /** Maximum tokens to generate */
  maxTokens?: number | undefined;
  /** Top-p sampling parameter */
  topP?: number | undefined;
  /** Zod schema for structured output (passed to Vercel AI SDK Output.object()) */
  outputSchema?: unknown;
}

/**
 * Payload for llmGenerate() — adds guardrail and agent step fields.
 */
export interface LLMGeneratePayload extends LLMGenerateOptions {
  /** Agent step number for step key naming */
  agent_step: number;
  /** Guardrails to apply after generation */
  guardrails?: Guardrail[] | undefined;
  /** Maximum guardrail retries (default: 2) */
  guardrail_max_retries?: number | undefined;
}

/**
 * Result from llmGenerate() — extends LLMResponse with execution metadata.
 */
export interface LLMGenerateResult extends LLMResponse {
  /** Agent run ID (from workflow context) */
  agent_run_id?: string | undefined;
  /** Execution status */
  status?: string | undefined;
}

/**
 * Payload for llmStream().
 */
export interface LLMStreamPayload extends LLMGenerateOptions {
  /** Agent step number for step key naming */
  agent_step: number;
}

// ── Conversion functions ───────────────────────────────────────────────

/**
 * Convert LlmToolDefinition[] (OpenAI format) to Vercel AI SDK tool format.
 */
export function convertToolsToVercel(
  tools: LlmToolDefinition[] | undefined
): Record<string, { description: string; inputSchema: ReturnType<typeof jsonSchema> }> | undefined {
  if (!tools || tools.length === 0) return undefined;

  const result: Record<
    string,
    { description: string; inputSchema: ReturnType<typeof jsonSchema> }
  > = {};
  for (const tool of tools) {
    result[tool.function.name] = {
      description: tool.function.description,
      inputSchema: jsonSchema(tool.function.parameters),
    };
  }
  return result;
}

/**
 * Convert Python tool results to Vercel CoreMessage[] with role 'tool'.
 */
export function convertToolResultsToMessages(
  toolResults: LLMToolResult[] | undefined
): CoreMessage[] {
  if (!toolResults || toolResults.length === 0) return [];

  return toolResults.map(
    (tr): CoreMessage => ({
      role: 'tool' as const,
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: tr.call_id,
          toolName: tr.name,
          output:
            typeof tr.output === 'string'
              ? { type: 'text' as const, value: tr.output }
              : // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- coerce unknown tool output to JSON ToolResultOutput
                { type: 'json' as const, value: tr.output as any },
        },
      ],
    })
  );
}

/**
 * Convert a Vercel AI SDK tool call to Python LLMToolCall format.
 */
export function convertVercelToolCallToPython(tc: {
  toolCallId: string;
  toolName: string;
  input: unknown;
}): LLMToolCall {
  return {
    id: tc.toolCallId,
    type: 'function',
    call_id: tc.toolCallId,
    function: {
      name: tc.toolName,
      arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
    },
  };
}

/**
 * Convert Python LLMToolCall to middleware ToolCall format (for guardrails).
 */
export function convertPythonToolCallToMiddleware(tc: LLMToolCall): ToolCall {
  let args: unknown;
  try {
    args = JSON.parse(tc.function.arguments);
  } catch {
    args = tc.function.arguments;
  }
  return {
    id: tc.call_id,
    name: tc.function.name,
    args,
  };
}

/**
 * Convert middleware ToolCall back to Python LLMToolCall format.
 */
export function convertMiddlewareToolCallToPython(tc: ToolCall): LLMToolCall {
  return {
    id: tc.id,
    type: 'function',
    call_id: tc.id,
    function: {
      name: tc.name,
      arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args),
    },
  };
}

/**
 * Convert Vercel AI SDK usage to Python LLMUsage format.
 */
export function convertVercelUsageToPython(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens?: number | undefined;
  inputTokenDetails?: {
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  };
}): LLMUsage {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const result: LLMUsage = {
    input_tokens: input,
    output_tokens: output,
    total_tokens: usage.totalTokens ?? input + output,
  };
  if (usage.inputTokenDetails?.cacheReadTokens != null) {
    result.cache_read_input_tokens = usage.inputTokenDetails.cacheReadTokens;
  }
  if (usage.inputTokenDetails?.cacheWriteTokens != null) {
    result.cache_creation_input_tokens = usage.inputTokenDetails.cacheWriteTokens;
  }
  return result;
}

/**
 * Convert Vercel finish reason (kebab-case) to Python format (snake_case).
 */
export function convertFinishReason(reason: string | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    default:
      return reason;
  }
}
