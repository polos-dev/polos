/**
 * Agent stream function — core execution loop.
 *
 * Matches Python sdk/python/polos/agents/stream.py _agent_stream_function.
 * Orchestrates: LLM call → tool execution → stop condition evaluation → repeat.
 */

import type { ModelMessage as CoreMessage } from 'ai';
import type { WorkflowContext } from '../core/context.js';
import { globalRegistry } from '../core/registry.js';
import { isToolWorkflow } from '../core/tool.js';
import type { BatchWorkflowInput } from '../core/step.js';
import { executeHookChain } from '../middleware/hook-executor.js';
import { llmGenerate } from '../llm/generate.js';
import { llmStream } from '../llm/stream.js';
import type { LLM } from '../llm/llm.js';
import type { LLMToolCall, LLMUsage, LLMToolResult, LLMGenerateResult } from '../llm/types.js';
import { convertToolResultsToMessages } from '../llm/types.js';
import type { Guardrail } from '../middleware/guardrail.js';
import type { Hook } from '../middleware/hook.js';
import type { PublishEventFn } from '../llm/stream.js';
import { getExecutionContext } from '../runtime/execution-context.js';
import type {
  StopCondition,
  StopConditionContext,
  StepInfo,
  ToolResultInfo,
} from './stop-conditions.js';
import { maxSteps as maxStepsFn } from './stop-conditions.js';
import type { LlmToolDefinition } from '../core/tool.js';
import { createLogger } from '../utils/logger.js';
import type { CompactionConfig, NormalizedCompactionConfig } from '../memory/types.js';
import type { ConversationMessage } from '../runtime/orchestrator-types.js';
import { compactIfNeeded, buildSummaryMessages, isSummaryPair } from '../memory/compaction.js';

const logger = createLogger({ name: 'agent-stream' });

// ── Types ────────────────────────────────────────────────────────────

/**
 * Agent configuration passed within the payload.
 * Matches Python agent_config dict structure.
 */
export interface AgentStreamConfig {
  system?: string | undefined;
  tools?: LlmToolDefinition[] | undefined;
  temperature?: number | undefined;
  maxOutputTokens?: number | undefined;
}

/**
 * Payload for agentStreamFunction.
 */
export interface AgentStreamPayload {
  agent_run_id: string;
  name: string;
  agent_config: AgentStreamConfig;
  input: string | Record<string, unknown>[];
  streaming: boolean;
}

/**
 * Definition of an agent for the stream function.
 */
export interface AgentDefinition {
  id: string;
  llm: LLM;
  tools: LlmToolDefinition[];
  stopConditions: StopCondition[];
  agentHooks: {
    onAgentStepStart: Hook[];
    onAgentStepEnd: Hook[];
    onToolStart: Hook[];
    onToolEnd: Hook[];
  };
  guardrails: Guardrail[];
  guardrailMaxRetries: number;
  /** Session compaction configuration — always enabled */
  compaction: CompactionConfig;
  outputSchema?: unknown;
  /** Original Zod schema for Vercel AI SDK structured output (Output.object()) */
  outputZodSchema?: unknown;
}

/**
 * Result from agent execution.
 * Matches Python AgentResult Pydantic model.
 */
export interface AgentStreamResult {
  agent_run_id: string;
  result: unknown;
  result_schema: string | null;
  tool_results: ToolResultInfo[];
  total_steps: number;
  usage: LLMUsage;
}

// ── Helper ───────────────────────────────────────────────────────────

function serializeToolOutput(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return 'null';
  }
}

// ── Main function ────────────────────────────────────────────────────

/**
 * Core agent execution loop.
 *
 * Matches Python _agent_stream_function:
 * 1. Retrieve conversation history if enabled
 * 2. Build conversation messages
 * 3. Loop: LLM call → tool execution → stop condition check
 * 4. Store conversation history
 * 5. Return AgentResult
 */
export async function agentStreamFunction(
  ctx: WorkflowContext,
  payload: AgentStreamPayload,
  agentDef: AgentDefinition
): Promise<AgentStreamResult> {
  const agentRunId = ctx.executionId;
  const agentConfig = payload.agent_config;
  const streaming = payload.streaming;
  const inputData = payload.input;

  // Result accumulator
  let finalInputTokens = 0;
  let finalOutputTokens = 0;
  let finalTotalTokens = 0;
  let finalCacheReadInputTokens = 0;
  let finalCacheCreationInputTokens = 0;
  let lastLlmResultContent: string | null = null;
  const allToolResults: ToolResultInfo[] = [];
  const steps: StepInfo[] = [];
  let endSteps = false;
  let checkedStructuredOutput = false;

  // ── Session compaction setup ──────────────────────────────────────
  // Normalize CompactionConfig -> NormalizedCompactionConfig
  let currentSummary: string | null = null;

  const normalizedCompaction: NormalizedCompactionConfig = {
    maxConversationTokens: agentDef.compaction.maxConversationTokens ?? 80000,
    maxSummaryTokens: agentDef.compaction.maxSummaryTokens ?? 20000,
    minRecentMessages: agentDef.compaction.minRecentMessages ?? 2,
    compactionModel: agentDef.compaction.compactionModel ?? agentDef.llm.model,
    enabled: agentDef.compaction.enabled ?? true,
  };

  // Build conversation messages — load prior session state first, then append current input
  let conversationMessages: unknown[] = [];

  // Load session memory (summary + uncompacted messages) if we have a sessionId
  if (ctx.sessionId) {
    const sessionId = ctx.sessionId;
    const loaded = await ctx.step.run('load_session_memory', async () => {
      const execCtx = getExecutionContext();
      if (!execCtx?.orchestratorClient) return null;
      try {
        const sessionMemory = await execCtx.orchestratorClient.getSessionMemory(sessionId);
        return {
          summary: sessionMemory.summary ?? null,
          messages: sessionMemory.messages,
        };
      } catch (err) {
        logger.warn('Failed to retrieve session memory', { error: String(err) });
        return null;
      }
    });

    if (loaded) {
      if (loaded.summary) {
        currentSummary = loaded.summary;
        const [summaryUser, summaryAssistant] = buildSummaryMessages(currentSummary);
        conversationMessages.push(summaryUser, summaryAssistant);
      }
      if (loaded.messages.length > 0) {
        conversationMessages.push(...loaded.messages);
      }
    }
  }

  // Add current input to conversation
  if (typeof inputData === 'string') {
    conversationMessages.push({ role: 'user', content: inputData });
  } else {
    conversationMessages.push(...inputData);
  }

  // Determine safety max_steps limit
  const stopConditions = agentDef.stopConditions;

  // Check if any stop condition is from maxSteps (matching Python exactly)
  let hasMaxStepsCondition = false;
  for (const sc of stopConditions) {
    if (sc.__stop_condition_fn__ === maxStepsFn.__stop_condition_fn__) {
      hasMaxStepsCondition = true;
      break;
    }
  }

  const safetyMaxSteps: number | null = hasMaxStepsCondition
    ? null
    : parseInt(process.env['POLOS_AGENT_MAX_STEPS'] ?? '20', 10);

  // Build publishEvent function for streaming
  const execCtxForPublish = getExecutionContext();
  const publishEvent: PublishEventFn = async (topic, eventData) => {
    if (execCtxForPublish?.orchestratorClient) {
      try {
        await execCtxForPublish.orchestratorClient.publishEvent({
          topic,
          events: [eventData],
          executionId: ctx.executionId,
          rootExecutionId: ctx.rootExecutionId,
        });
      } catch (err) {
        logger.warn('Failed to publish stream event', { error: String(err) });
      }
    }
  };

  // Main loop
  let agentStep = 1;

  while (!endSteps && (safetyMaxSteps === null || agentStep <= safetyMaxSteps)) {
    const currentIterationToolResults: LLMToolResult[] = [];

    // Execute on_agent_step_start hooks
    if (agentDef.agentHooks.onAgentStepStart.length > 0) {
      const hookResult = await executeHookChain(agentDef.agentHooks.onAgentStepStart, {
        ctx,
        hookName: `${String(agentStep)}.hook.on_agent_step_start`,
        payload: { step: agentStep, messages: conversationMessages },
        phase: 'onStart',
      });

      // Apply modifications
      if (typeof hookResult.payload === 'object' && 'messages' in hookResult.payload) {
        conversationMessages = (hookResult.payload as { messages: unknown[] }).messages;
      }

      if (!hookResult.success) {
        break;
      }
    }

    // Run compaction if needed (before LLM call)
    try {
      const compactionResult = await compactIfNeeded(
        conversationMessages as ConversationMessage[],
        currentSummary,
        normalizedCompaction
      );
      if (compactionResult.compacted) {
        conversationMessages = compactionResult.messages;
        currentSummary = compactionResult.summary;
      }
    } catch (err) {
      logger.warn('Compaction failed, continuing with uncompacted messages', {
        error: String(err),
      });
    }

    // Get guardrails from agent
    const guardrails = agentDef.guardrails;
    const guardrailMaxRetries = agentDef.guardrailMaxRetries;

    // Use llmGenerate if streaming=false OR guardrails are present (matching Python exactly)
    const useLlmGenerate = !streaming || guardrails.length > 0;

    let llmResult: LLMGenerateResult;

    // Only pass outputSchema when no tools are active (matching Python: response_format + tool use can conflict)
    const hasTools = agentConfig.tools !== undefined && agentConfig.tools.length > 0;
    const outputSchemaForLlm = !hasTools ? agentDef.outputZodSchema : undefined;

    if (useLlmGenerate) {
      llmResult = await llmGenerate(ctx, agentDef.llm, {
        messages: conversationMessages as CoreMessage[],
        system: agentConfig.system,
        tools: agentConfig.tools,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxOutputTokens,
        agent_step: agentStep,
        guardrails,
        guardrail_max_retries: guardrailMaxRetries,
        outputSchema: outputSchemaForLlm,
      });

      // If guardrails + streaming + content: publish one text_delta event (matching Python)
      if (guardrails.length > 0 && streaming && llmResult.content) {
        await ctx.step.publishEvent(`llm_generate:text_delta:${String(agentStep)}`, {
          topic: `workflow/${ctx.rootWorkflowId}/${ctx.rootExecutionId}`,
          type: 'text_delta',
          data: {
            step: agentStep,
            chunk_index: 1,
            content: llmResult.content,
            _metadata: {
              execution_id: agentRunId,
              workflow_id: ctx.workflowId,
            },
          },
        });
      }
    } else {
      // No guardrails - use streaming
      llmResult = await llmStream(
        ctx,
        agentDef.llm,
        {
          messages: conversationMessages as CoreMessage[],
          system: agentConfig.system,
          tools: agentConfig.tools,
          temperature: agentConfig.temperature,
          maxTokens: agentConfig.maxOutputTokens,
          agent_step: agentStep,
          outputSchema: outputSchemaForLlm,
        },
        publishEvent
      );
    }

    // Accumulate usage
    if (llmResult.usage) {
      finalInputTokens += llmResult.usage.input_tokens;
      finalOutputTokens += llmResult.usage.output_tokens;
      finalTotalTokens += llmResult.usage.total_tokens;
      if (llmResult.usage.cache_read_input_tokens != null) {
        finalCacheReadInputTokens += llmResult.usage.cache_read_input_tokens;
      }
      if (llmResult.usage.cache_creation_input_tokens != null) {
        finalCacheCreationInputTokens += llmResult.usage.cache_creation_input_tokens;
      }
    }

    lastLlmResultContent = llmResult.content;
    const toolCalls: LLMToolCall[] = llmResult.tool_calls ?? [];

    if (!llmResult.raw_output) {
      throw new Error(
        `LLM failed to generate output: agent_id=${agentDef.id}, agent_step=${String(agentStep)}`
      );
    }

    conversationMessages.push(...llmResult.raw_output);

    // Execute tools in batch
    const batchWorkflows: BatchWorkflowInput[] = [];
    const toolCallList: {
      tool_call_id: string;
      tool_call_call_id: string;
      tool_name: string;
      tool_call: LLMToolCall;
    }[] = [];

    let toolResultsRecordedList: ToolResultInfo[] = [];

    for (let idx = 0; idx < toolCalls.length; idx++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds checked by loop
      const toolCall = toolCalls[idx]!;

      if (!toolCall.function.name) {
        continue;
      }

      const toolName = toolCall.function.name;
      const toolArgsStr = toolCall.function.arguments;
      const toolCallId = toolCall.id;
      const toolCallCallId = toolCall.call_id;

      // Find the tool workflow in registry
      if (!globalRegistry.has(toolName)) {
        logger.warn(`Tool '${toolName}' not found in registry`);
        continue;
      }

      const toolWorkflow = globalRegistry.get(toolName);
      if (!isToolWorkflow(toolWorkflow)) {
        logger.warn(`Workflow '${toolName}' is not a tool workflow`);
        continue;
      }

      // Parse tool arguments
      let toolArgs: unknown;
      try {
        toolArgs = JSON.parse(toolArgsStr) as unknown;
      } catch {
        toolArgs = {};
      }

      // Execute on_tool_start hooks
      if (agentDef.agentHooks.onToolStart.length > 0) {
        const hookResult = await executeHookChain(agentDef.agentHooks.onToolStart, {
          ctx,
          hookName: `${String(agentStep)}.hook.on_tool_start.${String(idx)}`,
          payload: toolArgs,
          phase: 'onStart',
        });

        // Apply modifications
        if (hookResult.payload !== undefined) {
          toolArgs = hookResult.payload;
        }

        if (!hookResult.success) {
          throw new Error(hookResult.error ?? 'on_tool_start hook failed');
        }
      }

      // Add to batch
      batchWorkflows.push({ workflow: toolWorkflow, payload: toolArgs });
      toolCallList.push({
        tool_call_id: toolCallId,
        tool_call_call_id: toolCallCallId,
        tool_name: toolName,
        tool_call: toolCall,
      });
    }

    // Execute all tools in batch
    if (batchWorkflows.length > 0) {
      const batchResults = await ctx.step.batchInvokeAndWait(
        `execute_tools:step_${String(agentStep)}`,
        batchWorkflows
      );

      toolResultsRecordedList = [];

      for (let i = 0; i < batchResults.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds match batchResults
        const batchToolResult = batchResults[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds match batchResults
        const toolSpec = batchWorkflows[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds match batchResults
        const toolCallInfo = toolCallList[i]!;
        const toolName = toolCallInfo.tool_name;

        // Check success — convert errors to strings for the LLM (matching Python stream.py)
        const toolResult: unknown = batchToolResult.success
          ? batchToolResult.result
          : `Error: ${batchToolResult.error ?? 'unknown error'}`;
        const toolCallId = toolCallInfo.tool_call_id;
        const toolCallCallId = toolCallInfo.tool_call_call_id;

        // Execute on_tool_end hooks
        if (agentDef.agentHooks.onToolEnd.length > 0) {
          const hookResult = await executeHookChain(agentDef.agentHooks.onToolEnd, {
            ctx,
            hookName: `${String(agentStep)}.hook.on_tool_end.${String(i)}`,
            payload: toolSpec.payload,
            output: toolResult,
            phase: 'onEnd',
          });

          if (!hookResult.success) {
            throw new Error(hookResult.error ?? 'on_tool_end hook failed');
          }
        }

        // Serialize and add tool result to conversation for next iteration
        const toolJsonOutput = serializeToolOutput(toolResult);

        currentIterationToolResults.push({
          type: 'function_call_output',
          call_id: toolCallCallId,
          name: toolName,
          output: toolJsonOutput,
        });

        toolResultsRecordedList.push({
          tool_name: toolName,
          status: 'completed',
          result: toolResult,
          tool_call_id: toolCallId,
          tool_call_call_id: toolCallCallId,
        });
      }

      allToolResults.push(...toolResultsRecordedList);

      // Add tool results to conversation as role:'tool' messages
      // so the full conversation accumulates naturally
      const toolResultMessages = convertToolResultsToMessages(currentIterationToolResults);
      conversationMessages.push(...toolResultMessages);
    }

    // Build step record
    steps.push({
      step: agentStep,
      content: lastLlmResultContent,
      tool_calls: toolCalls,
      tool_results: toolResultsRecordedList,
      usage: llmResult.usage,
      raw_output: conversationMessages,
    });

    // Execute on_agent_step_end hooks
    if (agentDef.agentHooks.onAgentStepEnd.length > 0) {
      const hookResult = await executeHookChain(agentDef.agentHooks.onAgentStepEnd, {
        ctx,
        hookName: `${String(agentStep)}.hook.on_agent_step_end`,
        payload: { step: agentStep, messages: conversationMessages },
        output: steps[steps.length - 1],
        phase: 'onEnd',
      });

      // Apply modifications
      if (hookResult.output !== undefined) {
        steps[steps.length - 1] = hookResult.output as StepInfo;
      }

      if (!hookResult.success) {
        throw new Error(hookResult.error ?? 'on_agent_step_end hook failed');
      }
    }

    // No tool results, we're done
    if (currentIterationToolResults.length === 0) {
      endSteps = true;
    }

    // Evaluate stop conditions (if any)
    if (stopConditions.length > 0 && !endSteps) {
      const stopCtx: StopConditionContext = {
        steps: [...steps],
        agent_id: agentDef.id,
        agent_run_id: agentRunId,
      };

      for (let idx = 0; idx < stopConditions.length; idx++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds checked by loop
        const condition = stopConditions[idx]!;
        const funcName = condition.__stop_condition_name__ ?? 'unknown';

        const shouldStop = await ctx.step.run(
          `${String(agentStep)}.stop_condition.${funcName}.${String(idx)}`,
          () => condition(stopCtx),
          { input: stopCtx }
        );

        if (shouldStop) {
          endSteps = true;
          break;
        }
      }
    }

    // Structured output parsing (matching Python)
    if (endSteps && agentDef.outputSchema) {
      const parseResult = parseStructuredOutput(lastLlmResultContent, agentDef.outputSchema);

      if (checkedStructuredOutput && !parseResult.success) {
        throw new Error(
          `LLM failed to generate valid structured output: agent_id=${agentDef.id}, agent_step=${String(agentStep)}`
        );
      }

      checkedStructuredOutput = true;

      if (!parseResult.success) {
        // Reset and retry with fix prompt
        endSteps = false;

        const schemaJson = JSON.stringify(agentDef.outputSchema, null, 2);
        const fixPrompt =
          `The previous response was not valid JSON matching the ` +
          `required schema. Please reformat your response to be valid ` +
          `JSON that strictly conforms to this schema:\n\n${schemaJson}\n\n` +
          `Please provide ONLY valid JSON that matches the schema, ` +
          `with no additional text or formatting.`;
        conversationMessages.push({ role: 'user', content: fixPrompt });
      } else {
        lastLlmResultContent = parseResult.parsed as string | null;
      }
    }

    if (!endSteps) {
      agentStep++;
    }
  }

  // Store session memory (summary + uncompacted messages)
  if (ctx.sessionId) {
    const sessionId = ctx.sessionId;
    const execCtx = getExecutionContext();
    const orchestratorClient = execCtx?.orchestratorClient;
    if (orchestratorClient) {
      try {
        // Strip the summary pair from the front — only store real conversation messages
        const allMessages = conversationMessages as ConversationMessage[];
        const messagesStart = allMessages.length >= 2 && isSummaryPair(allMessages, 0) ? 2 : 0;
        const messagesToStore = allMessages.slice(messagesStart);

        const summaryToStore = currentSummary;
        await ctx.step.run(
          'store_session_memory',
          async () => {
            await orchestratorClient.putSessionMemory(sessionId, {
              summary: summaryToStore,
              messages: messagesToStore,
            });
          },
          {
            input: {
              messageCount: messagesToStore.length,
            },
          }
        );
      } catch (err) {
        logger.warn('Failed to store session memory', { error: String(err) });
      }
    }
  }

  // Return AgentResult
  return {
    agent_run_id: agentRunId,
    result: lastLlmResultContent,
    result_schema: null,
    tool_results: allToolResults,
    total_steps: agentStep,
    usage: {
      input_tokens: finalInputTokens,
      output_tokens: finalOutputTokens,
      total_tokens: finalTotalTokens,
      ...(finalCacheReadInputTokens > 0 && { cache_read_input_tokens: finalCacheReadInputTokens }),
      ...(finalCacheCreationInputTokens > 0 && {
        cache_creation_input_tokens: finalCacheCreationInputTokens,
      }),
    },
  };
}

// ── Structured output parsing ────────────────────────────────────────

interface ParseResult {
  parsed: unknown;
  success: boolean;
}

/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) from LLM output.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // Match ```json ... ``` or ``` ... ``` (with optional language identifier)
  const match = /^```(?:\w+)?\s*\n?([\s\S]*?)\n?\s*```$/.exec(trimmed);
  return match?.[1] ? match[1].trim() : trimmed;
}

function parseStructuredOutput(output: string | null, outputSchema: unknown): ParseResult {
  if (!output) {
    return { parsed: output, success: true };
  }

  try {
    const cleaned = stripCodeFences(output);
    const parsed: unknown = JSON.parse(cleaned);
    // If outputSchema is a Zod schema with parse method, validate
    if (typeof outputSchema === 'object' && outputSchema !== null && 'parse' in outputSchema) {
      const validated: unknown = (outputSchema as { parse: (v: unknown) => unknown }).parse(parsed);
      return { parsed: validated, success: true };
    }
    return { parsed, success: true };
  } catch (e) {
    logger.warn(`Failed to parse structured output: ${String(e)}`);
    return { parsed: output, success: false };
  }
}
