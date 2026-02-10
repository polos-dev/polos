/**
 * Agent definition — creates a Workflow with workflowType: 'agent'.
 *
 * Matches Python sdk/python/polos/agents/agent.py Agent class.
 * Follows the defineTool() pattern: defineAgent() creates a Workflow
 * extended with agent-specific properties.
 */

import type { LanguageModel } from 'ai';
import type { ZodSchema, ZodTypeDef } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { WorkflowContext } from '../core/context.js';
import type {
  QueueConfig,
  Workflow,
  WorkflowHandler,
  WorkflowRunClient,
  WorkflowRunOptions,
} from '../core/workflow.js';
import { defineWorkflow } from '../core/workflow.js';
import type { ToolWorkflow, LlmToolDefinition } from '../core/tool.js';
import { LLM } from '../llm/llm.js';
import type { Hook, HookHandler, Hook as HookObject } from '../middleware/hook.js';
import { normalizeHooks } from '../middleware/hook.js';
import type { Guardrail, GuardrailHandler } from '../middleware/guardrail.js';
import { normalizeGuardrails } from '../middleware/guardrail.js';
import type { PolosClient } from '../client.js';
import { assertNotInExecutionContext } from '../runtime/execution-context.js';
import { AgentRunConfig } from '../core/step.js';
import type { StopCondition } from './stop-conditions.js';
import { agentStreamFunction } from './stream.js';
import type { AgentStreamPayload, AgentStreamResult } from './stream.js';
import { StreamResult } from './stream-result.js';

// ── Types ────────────────────────────────────────────────────────────

/** Union type for hook inputs — a handler function, Hook object, or array */
type HookOrHandler = HookHandler | HookObject | (HookHandler | HookObject)[];

/**
 * Configuration for defineAgent().
 * Matches Python Agent.__init__ parameters.
 */
export interface DefineAgentConfig {
  /** Unique agent identifier */
  id: string;
  /** Vercel AI SDK model instance */
  model: LanguageModel;
  /** Agent description */
  description?: string | undefined;
  /** System prompt for the agent */
  systemPrompt?: string | undefined;
  /** Tools available to the agent (from defineTool()) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: ToolWorkflow<any, any, any>[] | undefined;
  /** Temperature for LLM generation */
  temperature?: number | undefined;
  /** Maximum output tokens */
  maxOutputTokens?: number | undefined;
  /** Queue assignment for execution */
  queue?: string | QueueConfig | undefined;
  /** Conditions to stop agent execution */
  stopConditions?: StopCondition[] | undefined;
  /** Zod schema for structured output */
  outputSchema?: ZodSchema<unknown, ZodTypeDef, unknown> | undefined;
  /** Hook(s) to run before workflow execution */
  onStart?: HookOrHandler | undefined;
  /** Hook(s) to run after workflow completion */
  onEnd?: HookOrHandler | undefined;
  /** Hook(s) to run before each agent step */
  onAgentStepStart?: HookOrHandler | undefined;
  /** Hook(s) to run after each agent step */
  onAgentStepEnd?: HookOrHandler | undefined;
  /** Hook(s) to run before tool execution */
  onToolStart?: HookOrHandler | undefined;
  /** Hook(s) to run after tool completion */
  onToolEnd?: HookOrHandler | undefined;
  /** Guardrails for output validation */
  guardrails?: (Guardrail | GuardrailHandler)[] | undefined;
  /** Maximum guardrail retries (default: 2) */
  guardrailMaxRetries?: number | undefined;
  /** Number of conversation history messages to retain (default: 10) */
  conversationHistory?: number | undefined;
}

/**
 * Payload for agent run() and stream() calls.
 * Contains the agent input and conversation context.
 */
export interface AgentRunPayload {
  /** Input for the agent (string message or message array) */
  input: string | Record<string, unknown>[];
  /** Conversation ID for history tracking */
  conversationId?: string | undefined;
}

/**
 * A Workflow extended with agent-specific properties.
 * Matches the ToolWorkflow pattern.
 */
export interface AgentWorkflow extends Workflow {
  /** Agent configuration */
  readonly agentConfig: DefineAgentConfig;
  /** LLM instance */
  readonly llm: LLM;
  /** Tool definitions for the LLM */
  readonly tools: LlmToolDefinition[];
  /** Stop conditions */
  readonly stopConditions: StopCondition[];
  /** Agent-specific hooks */
  readonly agentHooks: {
    onAgentStepStart: Hook[];
    onAgentStepEnd: Hook[];
    onToolStart: Hook[];
    onToolEnd: Hook[];
  };
  /** Guardrails */
  readonly guardrails: Guardrail[];

  /**
   * Invoke the agent with streaming, returning a StreamResult for
   * iterating over text chunks and events.
   * Cannot be called from within a workflow — use step.agentInvoke() instead.
   */
  stream(
    client: PolosClient,
    payload: AgentRunPayload,
    options?: WorkflowRunOptions
  ): Promise<StreamResult>;

  /**
   * Invoke the agent and wait for the final result.
   * Cannot be called from within a workflow — use step.agentInvokeAndWait() instead.
   */
  run(
    client: WorkflowRunClient,
    payload: AgentRunPayload,
    options?: WorkflowRunOptions
  ): Promise<AgentStreamResult>;

  /**
   * Prepare agent for batch execution with all run() params.
   * Returns an AgentRunConfig for use with batchAgentInvoke().
   * Matches Python Agent.with_input().
   */
  withInput(
    input: string | Record<string, unknown>[],
    options?: {
      conversationId?: string;
      sessionId?: string;
      userId?: string;
      initialState?: Record<string, unknown>;
      runTimeoutSeconds?: number;
      streaming?: boolean;
      kwargs?: Record<string, unknown>;
    }
  ): AgentRunConfig;
}

// ── isAgentWorkflow ──────────────────────────────────────────────────

/**
 * Type guard: checks whether a Workflow is an AgentWorkflow.
 */
export function isAgentWorkflow(workflow: Workflow): workflow is AgentWorkflow {
  return workflow.config.workflowType === 'agent';
}

// ── defineAgent ──────────────────────────────────────────────────────

/**
 * Define an agent — a workflow with `workflowType: 'agent'` plus LLM configuration.
 *
 * @example
 * ```typescript
 * import { defineAgent, defineTool, maxSteps } from '@polos/sdk';
 * import { openai } from '@ai-sdk/openai';
 *
 * const searchTool = defineTool({
 *   id: 'search',
 *   description: 'Search the knowledge base',
 *   inputSchema: z.object({ query: z.string() }),
 * }, async (ctx, input) => {
 *   return await db.search(input.query);
 * });
 *
 * const myAgent = defineAgent({
 *   id: 'my-agent',
 *   model: openai('gpt-4o'),
 *   systemPrompt: 'You are a helpful assistant.',
 *   tools: [searchTool],
 *   stopConditions: [maxSteps({ count: 10 })],
 * });
 * ```
 */
export function defineAgent(config: DefineAgentConfig): AgentWorkflow {
  // Create LLM instance from model
  const llm = new LLM({ model: config.model });

  // Build tool definitions for the LLM
  const toolDefs: LlmToolDefinition[] = (config.tools ?? []).map((t) => t.toLlmToolDefinition());

  // Normalize hooks
  const agentHooks = {
    onAgentStepStart: normalizeHooks(config.onAgentStepStart),
    onAgentStepEnd: normalizeHooks(config.onAgentStepEnd),
    onToolStart: normalizeHooks(config.onToolStart),
    onToolEnd: normalizeHooks(config.onToolEnd),
  };

  // Normalize guardrails
  const guardrails = normalizeGuardrails(config.guardrails);

  // Validate and collect stop conditions
  const stopConditions: StopCondition[] = config.stopConditions ?? [];

  // Convert outputSchema to JSON schema if provided
  const outputSchemaJson = config.outputSchema
    ? zodToJsonSchema(config.outputSchema, { target: 'openApi3' })
    : undefined;

  // Create handler closure
  const handler: WorkflowHandler<unknown, unknown, AgentStreamResult> = async (
    ctx: WorkflowContext,
    payload: unknown
  ): Promise<AgentStreamResult> => {
    const p = payload as Record<string, unknown>;

    // Extract fields from payload (matching Python _agent_execute)
    const input = p['input'] as string | Record<string, unknown>[];
    const streamingFlag = p['streaming'] as boolean | undefined;
    let conversationIdValue = p['conversation_id'] as string | undefined;

    // Generate conversation_id if not provided
    conversationIdValue ??= await ctx.step.uuid('generate_conversation_id');

    // Build the stream payload
    const streamPayload: AgentStreamPayload = {
      agent_run_id: ctx.executionId,
      name: config.id,
      agent_config: {
        system: config.systemPrompt,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
      },
      input,
      streaming: streamingFlag ?? true,
      conversation_id: conversationIdValue,
    };

    // Call the core agent stream function
    return agentStreamFunction(ctx, streamPayload, {
      id: config.id,
      llm,
      tools: toolDefs,
      stopConditions,
      agentHooks,
      guardrails,
      guardrailMaxRetries: config.guardrailMaxRetries ?? 2,
      conversationHistory: config.conversationHistory ?? 10,
      outputSchema: outputSchemaJson,
      outputZodSchema: config.outputSchema,
    });
  };

  // Create the underlying workflow
  const workflow = defineWorkflow(
    {
      id: config.id,
      description: config.description,
      workflowType: 'agent',
      queue: config.queue,
      onStart: config.onStart,
      onEnd: config.onEnd,
    },
    handler as WorkflowHandler<unknown, unknown, unknown>
  );

  // Extend with agent-specific fields (following defineTool pattern)
  const agentWorkflow: AgentWorkflow = Object.assign(workflow, {
    agentConfig: config,
    llm,
    tools: toolDefs,
    stopConditions,
    agentHooks,
    guardrails,

    async stream(
      client: PolosClient,
      payload: AgentRunPayload,
      options?: WorkflowRunOptions
    ): Promise<StreamResult> {
      assertNotInExecutionContext('agent.stream()', 'step.agentInvoke()');

      const orchPayload: Record<string, unknown> = {
        input: payload.input,
        streaming: true,
        ...(payload.conversationId !== undefined && { conversation_id: payload.conversationId }),
      };

      const invokeOpts: Record<string, unknown> = {};
      if (options?.sessionId !== undefined) invokeOpts['sessionId'] = options.sessionId;
      if (options?.userId !== undefined) invokeOpts['userId'] = options.userId;
      if (options?.initialState !== undefined) invokeOpts['initialState'] = options.initialState;
      if (options?.timeout !== undefined)
        invokeOpts['runTimeoutSeconds'] = Math.ceil(options.timeout);

      const handle = await client.invoke(agentWorkflow, orchPayload, invokeOpts);

      return new StreamResult(handle, client);
    },

    async run(
      client: WorkflowRunClient,
      payload: AgentRunPayload,
      options?: WorkflowRunOptions
    ): Promise<AgentStreamResult> {
      assertNotInExecutionContext('agent.run()', 'step.agentInvokeAndWait()');

      const orchPayload: Record<string, unknown> = {
        input: payload.input,
        streaming: false,
        ...(payload.conversationId !== undefined && { conversation_id: payload.conversationId }),
      };

      const invokeOpts: Record<string, unknown> = {};
      if (options?.sessionId !== undefined) invokeOpts['sessionId'] = options.sessionId;
      if (options?.userId !== undefined) invokeOpts['userId'] = options.userId;
      if (options?.initialState !== undefined) invokeOpts['initialState'] = options.initialState;
      if (options?.timeout !== undefined)
        invokeOpts['runTimeoutSeconds'] = Math.ceil(options.timeout);

      const handle = await client.invoke(agentWorkflow.id, orchPayload, invokeOpts);

      return (await handle.getResult(options?.timeout ?? 600)) as AgentStreamResult;
    },

    withInput(
      input: string | Record<string, unknown>[],
      options?: {
        conversationId?: string;
        sessionId?: string;
        userId?: string;
        initialState?: Record<string, unknown>;
        runTimeoutSeconds?: number;
        streaming?: boolean;
        kwargs?: Record<string, unknown>;
      }
    ): AgentRunConfig {
      return new AgentRunConfig({
        agent: agentWorkflow,
        input,
        ...(options?.sessionId !== undefined && { sessionId: options.sessionId }),
        ...(options?.conversationId !== undefined && { conversationId: options.conversationId }),
        ...(options?.userId !== undefined && { userId: options.userId }),
        ...(options?.streaming !== undefined && { streaming: options.streaming }),
        ...(options?.initialState !== undefined && { initialState: options.initialState }),
        ...(options?.runTimeoutSeconds !== undefined && {
          runTimeoutSeconds: options.runTimeoutSeconds,
        }),
        ...(options?.kwargs !== undefined && { kwargs: options.kwargs }),
      });
    },
  });

  return agentWorkflow;
}
