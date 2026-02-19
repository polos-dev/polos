/**
 * Tool definition and creation.
 *
 * Provides the defineTool function for creating typed tools that can be
 * exposed to LLMs. Tools are workflows with workflowType: 'tool' plus
 * LLM-specific metadata (description, JSON schema parameters).
 */

import { type ZodType, toJSONSchema } from 'zod';
import type { Channel } from '../channels/channel.js';
import type { WorkflowContext } from './context.js';
import type { QueueConfig, WorkflowHandler, Workflow } from './workflow.js';
import { defineWorkflow } from './workflow.js';
import type { HookHandler, Hook as HookObject } from '../middleware/hook.js';

// ── Tool approval ────────────────────────────────────────────────────

export type ToolApproval = 'always' | 'none';

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
  inputSchema?: ZodType<TInput> | undefined;
  /** Zod schema for output validation */
  outputSchema?: ZodType<TOutput> | undefined;
  /** Zod schema for state validation and defaults */
  stateSchema?: ZodType<TState> | undefined;
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
  /** Whether to auto-register in the global workflow registry (default: true) */
  autoRegister?: boolean | undefined;
  /** Require human approval before tool execution. @default undefined (no approval) */
  approval?: ToolApproval | undefined;
  /** Notification channels for suspend events. Overrides Worker-level channels. */
  channels?: Channel[] | undefined;
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

// ── Tool approval resume data ────────────────────────────────────────

interface ToolApprovalResumeData {
  data?: { approved?: boolean; feedback?: string };
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
    ? (() => {
        const { $schema: _, ...rest } = toJSONSchema(config.inputSchema) as Record<string, unknown>;
        return rest;
      })()
    : { type: 'object', properties: {} };

  // Wrap handler with approval gate when configured
  const effectiveHandler: typeof handler =
    config.approval === 'always'
      ? async (ctx, input) => {
          const approvalId = await ctx.step.uuid('_approval_id');
          const response = await ctx.step.suspend<Record<string, unknown>, ToolApprovalResumeData>(
            `approve_${config.id}_${approvalId}`,
            {
              data: {
                _form: {
                  title: `Approve tool: ${config.id}`,
                  description: `The agent wants to use the "${config.id}" tool.`,
                  fields: [
                    {
                      key: 'approved',
                      type: 'boolean',
                      label: 'Approve this tool call?',
                      required: true,
                      default: false,
                    },
                    {
                      key: 'feedback',
                      type: 'textarea',
                      label: 'Feedback for the agent (optional)',
                      description: 'If rejecting, tell the agent what to do instead.',
                      required: false,
                    },
                  ],
                  context: { tool: config.id, input },
                },
                _source: 'tool_approval',
                _tool: config.id,
              },
            }
          );

          if (response.data?.approved !== true) {
            const feedback = response.data?.feedback;
            throw new Error(
              `Tool "${config.id}" was rejected by the user.${feedback ? ` Feedback: ${feedback}` : ''}`
            );
          }

          return handler(ctx, input);
        }
      : handler;

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
      channels: config.channels,
    },
    effectiveHandler as WorkflowHandler<TInput, TState, TOutput>,
    config.autoRegister === undefined ? undefined : { autoRegister: config.autoRegister }
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
