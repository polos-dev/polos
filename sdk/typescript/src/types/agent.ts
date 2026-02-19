/**
 * Agent-related type definitions.
 *
 * Note: Core agent implementation types (StopCondition, StopConditionContext,
 * StepInfo, ToolResultInfo, AgentWorkflow, DefineAgentConfig) are defined in
 * src/agents/ and exported from there. This file contains supplementary types
 * used by the public API (Guardrail, Agent, AgentStream, etc.) and placeholder
 * types for future client-side features.
 */

import type { LanguageModel, ModelMessage } from 'ai';

// Backwards-compat alias: CoreMessage was renamed to ModelMessage in ai v6
type CoreMessage = ModelMessage;
import type { ZodType } from 'zod';
import type { WorkflowContext, QueueConfig, Hook } from './workflow.js';
import type { TokenUsage, ToolCall } from './llm.js';

/**
 * Tool definition with Zod schemas for input/output.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Unique tool identifier */
  id: string;
  /** Tool description (shown to LLM) */
  description: string;
  /** Zod schema for input validation */
  inputSchema: ZodType<TInput>;
  /** Zod schema for output validation */
  outputSchema: ZodType<TOutput>;
  /** Tool handler function */
  handler: ToolHandler<TInput, TOutput>;
}

/**
 * Tool handler function type.
 */
export type ToolHandler<TInput, TOutput> = (
  ctx: WorkflowContext,
  input: TInput
) => Promise<TOutput>;

/**
 * Configuration for defining a tool.
 */
export interface ToolConfig<TInput = unknown, TOutput = unknown> {
  /** Unique tool identifier */
  id: string;
  /** Tool description (shown to LLM) */
  description: string;
  /** Zod schema for input validation */
  inputSchema: ZodType<TInput>;
  /** Zod schema for output validation */
  outputSchema: ZodType<TOutput>;
}

/**
 * Guardrail function type for validating LLM outputs.
 */
export type Guardrail = (
  ctx: WorkflowContext,
  guardrailCtx: GuardrailContext
) => Promise<GuardrailResult>;

/**
 * Context passed to guardrails.
 */
export interface GuardrailContext {
  /** Text content from LLM (if any) */
  content?: string;
  /** Tool calls from LLM (if any) */
  toolCalls: ToolCall[];
  /** Messages so far in the conversation */
  messages: CoreMessage[];
}

/**
 * Result from a guardrail execution.
 */
export interface GuardrailResult {
  /** Whether to continue execution */
  continue: boolean;
  /** Error message if guardrail failed */
  error?: string;
  /** Modified content to use instead */
  modifiedContent?: string;
  /** Modified tool calls to use instead */
  modifiedToolCalls?: ToolCall[];
}

export const GuardrailResult = {
  /** Continue execution without modifications */
  continue: (): GuardrailResult => ({ continue: true }),

  /** Continue execution with modifications */
  continueWith: (options: {
    modifiedContent?: string;
    modifiedToolCalls?: ToolCall[];
  }): GuardrailResult => {
    const result: GuardrailResult = { continue: true };
    if (options.modifiedContent !== undefined) {
      result.modifiedContent = options.modifiedContent;
    }
    if (options.modifiedToolCalls !== undefined) {
      result.modifiedToolCalls = options.modifiedToolCalls;
    }
    return result;
  },

  /** Stop execution with an error */
  fail: (error: string): GuardrailResult => ({
    continue: false,
    error,
  }),
};

/**
 * Configuration for defining an agent (placeholder for client-side usage).
 */
export interface AgentConfig<TOutput = string, TState = unknown> {
  /** Unique agent identifier */
  id: string;
  /** Vercel AI SDK model instance */
  model: LanguageModel;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Tools available to the agent */
  tools?: Tool[];

  /** LLM generation configuration */
  temperature?: number;
  maxTokens?: number;
  topP?: number;

  /** Queue assignment for execution */
  queue?: string | QueueConfig;

  /** Zod schema for structured output */
  outputSchema?: ZodType<TOutput>;

  /** Lifecycle hooks */
  onStart?: Hook<string, TState>;
  onEnd?: Hook<string, TState>;
  onAgentStepStart?: Hook<string, TState>;
  onAgentStepEnd?: Hook<string, TState>;
  onToolStart?: Hook<string, TState>;
  onToolEnd?: Hook<string, TState>;

  /** Guardrails for output validation */
  guardrails?: Guardrail[];
  /** Max retries when guardrail fails */
  guardrailMaxRetries?: number;
}

/**
 * Result from running an agent (client-side).
 */
export interface AgentResult<TOutput = string> {
  /** Agent output (typed if outputSchema provided) */
  output: TOutput;
  /** All messages in the conversation */
  messages: CoreMessage[];
  /** Token usage statistics */
  usage: TokenUsage;
  /** Steps executed by the agent */
  steps: AgentStep[];
}

/**
 * A single step in agent execution (client-side view).
 */
export interface AgentStep {
  /** Type of step */
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text';
  /** Text content (for thinking/text steps) */
  content?: string;
  /** Tool name (for tool_call/tool_result steps) */
  toolName?: string;
  /** Tool input (for tool_call steps) */
  toolInput?: unknown;
  /** Tool output (for tool_result steps) */
  toolOutput?: unknown;
  /** Token usage for this step */
  usage?: TokenUsage;
  /** When this step occurred */
  timestamp: Date;
}

/**
 * Agent instance with run/stream methods.
 */
export interface Agent<TOutput = string, TState = unknown> {
  /** Agent identifier */
  id: string;
  /** Agent configuration */
  config: AgentConfig<TOutput, TState>;

  /**
   * Run the agent with a user message and wait for result.
   */
  run(message: string, options?: AgentRunOptions): Promise<AgentResult<TOutput>>;

  /**
   * Run the agent and stream the response.
   */
  stream(message: string, options?: AgentRunOptions): Promise<AgentStream<TOutput>>;
}

/**
 * Options for running an agent.
 */
export interface AgentRunOptions {
  /** Initial conversation messages */
  messages?: CoreMessage[];
  /** Timeout in milliseconds */
  timeout?: number;
  /** Initial state */
  initialState?: unknown;
}

/**
 * Stream of agent events.
 */
export interface AgentStream<TOutput = string> extends AsyncIterable<AgentStreamEvent> {
  /** Async iterable of text chunks only */
  textChunks: AsyncIterable<string>;

  /** Accumulate all text chunks into a single string */
  text(): Promise<string>;

  /** Wait for final result */
  result(): Promise<AgentResult<TOutput>>;
}

/**
 * Events emitted during agent streaming.
 * Matches Python's actual SSE event types.
 */
export type AgentStreamEvent =
  | { type: 'stream_start'; step: number }
  | { type: 'text_delta'; step: number; chunkIndex: number; content?: string }
  | { type: 'tool_call'; step: number; chunkIndex: number; toolCall?: unknown }
  | { type: 'agent_finish'; result: unknown };
