/**
 * LLM class wrapping Vercel AI SDK LanguageModel.
 *
 * Provides Python-compatible generate() and stream() methods
 * without durability or guardrails (use llmGenerate/llmStream for those).
 */

import { generateText, streamText, Output } from 'ai';
import type { ModelMessage as CoreMessage, LanguageModel } from 'ai';
import type { ZodSchema } from 'zod';
import type { LLMGenerateOptions, LLMResponse, LLMStreamEvent, LLMToolCall } from './types.js';
import {
  convertToolsToVercel,
  convertToolResultsToMessages,
  convertVercelToolCallToPython,
  convertVercelUsageToPython,
  convertFinishReason,
  getModelId,
  getModelProvider,
} from './types.js';

/** Cache breakpoint marker for Anthropic prompt caching. */
export const ANTHROPIC_CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
};

/** Check whether a LanguageModel is an Anthropic model. */
export function isAnthropicModel(model: LanguageModel): boolean {
  return getModelProvider(model).startsWith('anthropic');
}

/**
 * Remove all existing cache control markers from the args object (in-place).
 *
 * Must be called before applying fresh breakpoints so that stale markers
 * from previous agent loop iterations don't accumulate and exceed
 * Anthropic's 4-block limit.
 */
function stripAnthropicCacheControl(args: Record<string, unknown>): void {
  // Strip from system prompt
  const system = args['system'];
  if (system && typeof system === 'object' && 'providerOptions' in system) {
    delete (system as Record<string, unknown>)['providerOptions'];
  }

  // Strip from tools
  const tools = args['tools'] as Record<string, Record<string, unknown>> | undefined;
  if (tools) {
    for (const name of Object.keys(tools)) {
      delete tools[name]?.['providerOptions'];
    }
  }

  // Strip from messages
  const messages = args['messages'] as Record<string, unknown>[] | undefined;
  if (messages) {
    for (const msg of messages) {
      delete msg['providerOptions'];
    }
  }
}

/**
 * Add Anthropic prompt-caching breakpoints to the args object (in-place).
 *
 * Marks the system prompt, the last tool, and the last message with
 * `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }`
 * so the @ai-sdk/anthropic provider can enable prompt caching.
 * Strips any existing markers first to stay within the 4-block limit.
 */
export function applyAnthropicCacheControl(
  args: Record<string, unknown>,
  model: LanguageModel
): void {
  if (!isAnthropicModel(model)) return;

  stripAnthropicCacheControl(args);

  // 1. System prompt: convert string to SystemModelMessage with cache control
  if (typeof args['system'] === 'string') {
    args['system'] = {
      role: 'system',
      content: args['system'],
      providerOptions: ANTHROPIC_CACHE_BREAKPOINT,
    };
  }

  // 2. Tools: add cache control to the last tool
  const tools = args['tools'] as Record<string, Record<string, unknown>> | undefined;
  if (tools) {
    const toolNames = Object.keys(tools);
    if (toolNames.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lastToolName = toolNames[toolNames.length - 1]!;
      tools[lastToolName] = {
        ...tools[lastToolName],
        providerOptions: ANTHROPIC_CACHE_BREAKPOINT,
      };
    }
  }

  // 3. Last message: add cache control to the last message
  const messages = args['messages'] as Record<string, unknown>[] | undefined;
  if (messages && messages.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastMsg = messages[messages.length - 1]!;
    messages[messages.length - 1] = {
      ...lastMsg,
      providerOptions: ANTHROPIC_CACHE_BREAKPOINT,
    };
  }
}

/**
 * Build args object for generateText/streamText, only including defined properties
 * to satisfy exactOptionalPropertyTypes.
 */
function buildGenerateArgs(
  model: LanguageModel,
  messages: CoreMessage[],
  options: LLMGenerateOptions
): Record<string, unknown> {
  const args: Record<string, unknown> = { model, messages };
  const tools = convertToolsToVercel(options.tools);
  if (options.system !== undefined) args['system'] = options.system;
  if (tools !== undefined) args['tools'] = tools;
  if (options.temperature !== undefined) args['temperature'] = options.temperature;
  if (options.maxTokens !== undefined) args['maxTokens'] = options.maxTokens;
  if (options.topP !== undefined) args['topP'] = options.topP;
  if (options.outputSchema) {
    args['experimental_output'] = Output.object({ schema: options.outputSchema as ZodSchema });
  }
  applyAnthropicCacheControl(args, model);
  return args;
}

/**
 * LLM wraps a Vercel AI SDK LanguageModel to provide Python-compatible
 * generate() and stream() methods.
 *
 * @example
 * ```typescript
 * import { LLM } from '@polos/sdk';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const llm = new LLM({ model: anthropic('claude-sonnet-4-20250514') });
 * const response = await llm.generate({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * console.log(response.content);
 * ```
 */
export class LLM {
  readonly model: LanguageModel;

  constructor(options: { model: LanguageModel }) {
    this.model = options.model;
  }

  /**
   * Generate a response (non-streaming).
   *
   * Returns an LLMResponse in Python-compatible format.
   */
  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const messages = [...options.messages, ...convertToolResultsToMessages(options.tool_results)];

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- conditionally built args to satisfy exactOptionalPropertyTypes
    const result = await generateText(buildGenerateArgs(this.model, messages, options) as any);

    const toolCalls: LLMToolCall[] | null =
      result.toolCalls.length > 0
        ? result.toolCalls.map((tc) => convertVercelToolCallToPython(tc))
        : null;

    return {
      content: result.text || null,
      usage: convertVercelUsageToPython(result.totalUsage),
      tool_calls: toolCalls,
      raw_output: [...result.response.messages],
      model: getModelId(this.model),
      stop_reason: convertFinishReason(result.finishReason),
    };
  }

  /**
   * Stream a response.
   *
   * Yields LLMStreamEvents in Python-compatible format.
   */
  async *stream(options: LLMGenerateOptions): AsyncGenerator<LLMStreamEvent> {
    const messages = [...options.messages, ...convertToolResultsToMessages(options.tool_results)];

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- conditionally built args to satisfy exactOptionalPropertyTypes
    const result = streamText(buildGenerateArgs(this.model, messages, options) as any);

    let finishUsage:
      | {
          inputTokens: number | undefined;
          outputTokens: number | undefined;
          totalTokens?: number | undefined;
          inputTokenDetails?: {
            cacheReadTokens?: number | undefined;
            cacheWriteTokens?: number | undefined;
          };
        }
      | undefined;
    let finishReason: string | undefined;

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          yield { type: 'text_delta', data: { content: part.text } };
          break;
        case 'tool-call':
          yield {
            type: 'tool_call',
            data: { tool_call: convertVercelToolCallToPython(part) },
          };
          break;
        case 'finish':
          finishUsage = part.totalUsage;
          finishReason = part.finishReason;
          break;
        case 'error':
          yield {
            type: 'error',
            data: {
              error: part.error instanceof Error ? part.error.message : String(part.error),
            },
          };
          break;
        // Ignore all other part types (reasoning, step-start, step-finish, etc.)
        default:
          break;
      }
    }

    // After stream completes, get the full response messages for raw_output
    // (matching generate() which returns result.response.messages)
    const fullResponse = await result.response;
    const rawOutput = [...fullResponse.messages];

    yield {
      type: 'done',
      data: {
        usage: finishUsage
          ? convertVercelUsageToPython(finishUsage)
          : { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        raw_output: rawOutput,
        model: getModelId(this.model),
        stop_reason: convertFinishReason(finishReason),
      },
    };
  }
}
