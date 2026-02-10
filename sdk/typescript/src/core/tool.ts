/**
 * Tool definition and creation.
 *
 * Provides the defineTool function for creating typed tools that can be
 * exposed to LLMs. Tools are workflows with workflowType: 'tool' plus
 * LLM-specific metadata (description, JSON schema parameters).
 */

import type { ZodSchema, ZodTypeDef } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { WorkflowContext } from './context.js';
import type { QueueConfig, WorkflowHandler, Workflow } from './workflow.js';
import { defineWorkflow } from './workflow.js';
import type { HookHandler, Hook as HookObject } from '../middleware/hook.js';

// ── LLM tool definition ──────────────────────────────────────────────

/**
 * LLM tool definition format (OpenAI/Anthropic compatible).
 */
export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ── DefineToolConfig ─────────────────────────────────────────────────

/**
 * Configuration for defineTool().
 */
export interface DefineToolConfig<TInput = unknown, TOutput = unknown, TState = unknown> {
  /** Unique tool identifier */
  id: string;
  /** Tool description shown to LLMs */
  description: string;
  /** Zod schema for input validation (optional — some tools take no input) */
  inputSchema?: ZodSchema<TInput, ZodTypeDef, unknown> | undefined;
  /** Zod schema for output validation */
  outputSchema?: ZodSchema<TOutput, ZodTypeDef, unknown> | undefined;
  /** Zod schema for state validation and defaults */
  stateSchema?: ZodSchema<TState, ZodTypeDef, unknown> | undefined;
  /** Queue assignment */
  queue?: string | QueueConfig | undefined;
  /** Hook(s) to run before tool execution */
  onStart?:
    | HookHandler<TInput, TState>
    | HookObject<TInput, TState>
    | (HookHandler<TInput, TState> | HookObject<TInput, TState>)[]
    | undefined;
  /** Hook(s) to run after tool completion */
  onEnd?:
    | HookHandler<TInput, TState>
    | HookObject<TInput, TState>
    | (HookHandler<TInput, TState> | HookObject<TInput, TState>)[]
    | undefined;
}

// ── ToolWorkflow ─────────────────────────────────────────────────────

/**
 * A Workflow with tool-specific LLM metadata.
 *
 * Extends the base Workflow interface with fields needed for LLM tool
 * integration: description, JSON schema parameters, and methods for
 * generating LLM-compatible tool definitions.
 */
export interface ToolWorkflow<
  TInput = unknown,
  TOutput = unknown,
  TState = unknown,
> extends Workflow<TInput, TState, TOutput> {
  /** Tool description shown to LLMs */
  readonly toolDescription: string;
  /** JSON schema for tool parameters */
  readonly toolParameters: Record<string, unknown>;
  /** Generate an LLM-compatible tool definition */
  toLlmToolDefinition(): LlmToolDefinition;
  /** Get the tool type (default: "default") */
  getToolType(): string;
  /** Get additional tool metadata (default: undefined) */
  getToolMetadata(): Record<string, unknown> | undefined;
}

// ── isToolWorkflow ───────────────────────────────────────────────────

/**
 * Type guard: checks whether a Workflow is a ToolWorkflow.
 */
export function isToolWorkflow(workflow: Workflow): workflow is ToolWorkflow {
  return workflow.config.workflowType === 'tool';
}

// ── defineTool ───────────────────────────────────────────────────────

/**
 * Define a tool — a workflow with `workflowType: 'tool'` plus LLM metadata.
 *
 * @example
 * ```typescript
 * import { defineTool } from '@polos/sdk';
 * import { z } from 'zod';
 *
 * const searchKb = defineTool({
 *   id: 'search-kb',
 *   description: 'Search the knowledge base',
 *   inputSchema: z.object({
 *     query: z.string().describe('Search query'),
 *     limit: z.number().optional().describe('Max results'),
 *   }),
 * }, async (ctx, input) => {
 *   const results = await ctx.step.run('search', () => db.search(input.query));
 *   return { results };
 * });
 *
 * // Get LLM tool definition
 * const toolDef = searchKb.toLlmToolDefinition();
 *
 * // Execute via client
 * const result = await client.run(searchKb, { query: 'test' });
 * ```
 */
export function defineTool<TInput = unknown, TOutput = unknown, TState = unknown>(
  config: DefineToolConfig<TInput, TOutput, TState>,
  handler: (ctx: WorkflowContext<TState>, input: TInput) => Promise<TOutput>
): ToolWorkflow<TInput, TOutput, TState> {
  // Derive JSON schema parameters from inputSchema
  const toolParameters: Record<string, unknown> = config.inputSchema
    ? (zodToJsonSchema(config.inputSchema, { target: 'openApi3' }) as Record<string, unknown>)
    : { type: 'object', properties: {} };

  // Create the underlying workflow
  const workflow = defineWorkflow<TInput, TState, TOutput>(
    {
      id: config.id,
      description: config.description,
      workflowType: 'tool',
      payloadSchema: config.inputSchema,
      stateSchema: config.stateSchema,
      outputSchema: config.outputSchema,
      queue: config.queue,
      onStart: config.onStart,
      onEnd: config.onEnd,
    },
    handler as WorkflowHandler<TInput, TState, TOutput>
  );

  // Extend with tool-specific fields
  const toolWorkflow: ToolWorkflow<TInput, TOutput, TState> = Object.assign(workflow, {
    toolDescription: config.description,
    toolParameters,
    toLlmToolDefinition(): LlmToolDefinition {
      return {
        type: 'function' as const,
        function: {
          name: config.id,
          description: config.description,
          parameters: toolParameters,
        },
      };
    },
    getToolType(): string {
      return 'default';
    },
    getToolMetadata(): Record<string, unknown> | undefined {
      return undefined;
    },
  });

  return toolWorkflow;
}
