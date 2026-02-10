/**
 * Durable LLM generation with guardrail support.
 *
 * Matches Python _llm_generate exactly: wraps LLM.generate() in ctx.step.run()
 * for durability and runs guardrails with retry on failure.
 */

import type { WorkflowContext } from '../core/context.js';
import type { CoreMessage } from '../types/llm.js';
import { executeGuardrailChain } from '../middleware/guardrail-executor.js';
import type { LLM } from './llm.js';
import type { LLMGeneratePayload, LLMGenerateResult } from './types.js';
import { convertPythonToolCallToMiddleware, convertMiddlewareToolCallToPython } from './types.js';

/**
 * Durable LLM generation with guardrail support.
 *
 * Matches Python _llm_generate exactly:
 * - Step key is `llm_generate:{agent_step}` (same key across retries, matching Python)
 * - Each guardrail is executed as a durable step via ctx.step.run()
 * - On guardrail failure, appends feedback as user message and retries
 * - On guardrail success, applies content/tool_call modifications
 *
 * @example
 * ```typescript
 * const result = await llmGenerate(ctx, llm, {
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   agent_step: 1,
 *   guardrails: [myGuardrail],
 *   guardrail_max_retries: 2,
 * });
 * ```
 */
export async function llmGenerate(
  ctx: WorkflowContext,
  llm: LLM,
  payload: LLMGeneratePayload
): Promise<LLMGenerateResult> {
  const {
    agent_step,
    guardrails,
    guardrail_max_retries: maxRetries = 2,
    ...generateOptions
  } = payload;

  const workingMessages: CoreMessage[] = [...generateOptions.messages];

  // Step key matches Python: `llm_generate:{agent_step}` (no retry count)
  const stepKey = `llm_generate:${String(agent_step)}`;

  let guardrailRetryCount = 0;

  // Guardrail retry loop (matching Python: while guardrail_retry_count <= guardrail_max_retries)
  while (guardrailRetryCount <= maxRetries) {
    // Build the LLM call options
    const llmCallOptions = {
      ...generateOptions,
      messages: workingMessages,
    };

    // Call LLM via step.run() for durable execution
    const response = await ctx.step.run(stepKey, () => llm.generate(llmCallOptions), {
      input: {
        kwargs: {
          messages: workingMessages,
          system: generateOptions.system,
          tools: generateOptions.tools,
          temperature: generateOptions.temperature,
          maxTokens: generateOptions.maxTokens,
        },
      },
    });

    // Build result (matching Python llm_result dict)
    const llmResult: LLMGenerateResult = {
      agent_run_id: ctx.executionId,
      status: 'completed',
      content: response.content,
      tool_calls: response.tool_calls,
      usage: response.usage,
      raw_output: response.raw_output,
      model: response.model,
      stop_reason: response.stop_reason,
    };

    // If no guardrails, return immediately (matching Python: if not guardrails: return llm_result)
    if (!guardrails || guardrails.length === 0) {
      return llmResult;
    }

    // Execute guardrails on the LLM result (matching Python execute_guardrails)
    // Convert tool calls to middleware format
    const middlewareToolCalls = (llmResult.tool_calls ?? []).map(convertPythonToolCallToMiddleware);

    // Use the shared executeGuardrailChain (each guardrail runs as a durable step)
    const guardrailChainResult = await executeGuardrailChain(guardrails, {
      ctx,
      guardrailName: `${String(agent_step)}.guardrail`,
      content: llmResult.content ?? undefined,
      toolCalls: middlewareToolCalls,
    });

    // Check guardrail result (matching Python: if guardrail_result.action == HookAction.FAIL)
    if (!guardrailChainResult.success) {
      // Guardrail failed - check if we can retry
      const guardrailErrorMessage = guardrailChainResult.error ?? 'Guardrail validation failed';

      if (guardrailRetryCount >= maxRetries) {
        // Exhausted retries - raise exception (matching Python)
        throw new Error(
          `Guardrail failed after ${String(maxRetries)} retries. Last error: ${guardrailErrorMessage}`
        );
      }

      // Add feedback to messages for retry (matching Python: messages.append({"role": "user", ...}))
      const feedbackMessage =
        `Previous attempt failed guardrail validation: ${guardrailErrorMessage}. ` +
        `Please revise your response accordingly.`;
      workingMessages.push({ role: 'user', content: feedbackMessage });
      guardrailRetryCount++;
      continue; // Retry LLM generation
    }

    // CONTINUE - all guardrails passed, apply accumulated modifications (matching Python)
    // Python always applies modified_content/modified_tool_calls when not None/empty
    if (guardrailChainResult.content !== undefined) {
      llmResult.content = guardrailChainResult.content ?? null;
    }
    // Always apply tool calls from chain result (matching Python: modified_tool_calls is
    // always a list, and `is not None` is always True, so Python always applies).
    // This ensures guardrails that remove tool calls (set to []) are respected.
    const modifiedToolCalls = guardrailChainResult.toolCalls.map(convertMiddlewareToolCallToPython);
    llmResult.tool_calls = modifiedToolCalls.length > 0 ? modifiedToolCalls : null;

    return llmResult;
  }

  // Should not reach here, but just in case (matching Python)
  throw new Error(`Failed to generate valid response after ${String(maxRetries)} retries`);
}
