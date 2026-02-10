/**
 * LLM-related type definitions.
 * Re-exports types from Vercel AI SDK and adds Polos-specific types.
 */

import type {
  LanguageModel,
  ModelMessage,
  Tool,
  GenerateTextResult,
  StreamTextResult,
  ToolChoice,
} from 'ai';

// Backwards-compat alias: CoreMessage was renamed to ModelMessage in ai v6
export type CoreMessage = ModelMessage;

// Re-export Vercel AI SDK types for convenience
export type {
  LanguageModel,
  ModelMessage,
  Tool as CoreTool, // Alias for backwards compatibility
  GenerateTextResult,
  StreamTextResult,
  ToolChoice as CoreToolChoice, // Alias for backwards compatibility
};

/**
 * Token usage statistics.
 */
export interface TokenUsage {
  /** Tokens used in the prompt */
  promptTokens: number;
  /** Tokens generated in the completion */
  completionTokens: number;
  /** Total tokens used */
  totalTokens: number;
}

/**
 * Reason why the LLM stopped generating.
 */
export type FinishReason = 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error' | 'other';

/**
 * A tool call made by the LLM.
 */
export interface ToolCall {
  /** Unique identifier for this tool call */
  id: string;
  /** Name of the tool to call */
  name: string;
  /** Arguments to pass to the tool */
  args: unknown;
}

/**
 * Result of a tool execution.
 */
export interface ToolResult {
  /** ID of the tool call this result corresponds to */
  toolCallId: string;
  /** Name of the tool */
  toolName: string;
  /** Result from the tool */
  result: unknown;
}

/**
 * Configuration for LLM generation.
 */
export interface GenerateConfig {
  /** Temperature for randomness (0-2, default varies by model) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Top-p sampling parameter */
  topP?: number;
  /** Top-k sampling parameter */
  topK?: number;
  /** Frequency penalty (-2 to 2) */
  frequencyPenalty?: number;
  /** Presence penalty (-2 to 2) */
  presencePenalty?: number;
  /** Sequences that will stop generation */
  stopSequences?: string[];
}

/**
 * Supported LLM providers (via Vercel AI SDK).
 */
export type LLMProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'azure'
  | 'amazon-bedrock'
  | 'mistral'
  | 'cohere'
  | 'fireworks'
  | 'together';
