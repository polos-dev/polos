/**
 * Durable LLM streaming with event publishing.
 *
 * Matches Python _llm_stream: streams LLM output inside ctx.step.run()
 * and publishes events directly (not via durable step execution).
 */

import type { WorkflowContext } from '../core/context.js';
import type { EventData } from '../types/events.js';
import type { LLM } from './llm.js';
import type { LLMGenerateResult, LLMStreamPayload, LLMToolCall, LLMUsage } from './types.js';
import { getModelId } from './types.js';

/**
 * Function signature for publishing events directly (not via step system).
 * Matches Python's `publish_event(client, topic, event_data)` pattern.
 */
export type PublishEventFn = (topic: string, eventData: EventData) => Promise<void>;

/**
 * Durable LLM streaming with event publishing.
 *
 * Wraps the streaming operation in ctx.step.run() for durability.
 * Events are published directly via the provided publishEvent function,
 * bypassing the step system (matching Python's direct publish_event calls).
 *
 * @param ctx - Workflow context for durability and metadata
 * @param llm - LLM instance to stream from
 * @param payload - Stream payload with messages, tools, agent_step, etc.
 * @param publishEvent - Function to publish events directly (e.g. from PolosClient or OrchestratorClient)
 *
 * @example
 * ```typescript
 * const result = await llmStream(ctx, llm, {
 *   messages: [{ role: 'user', content: 'Tell me a story' }],
 *   agent_step: 1,
 * }, async (topic, eventData) => {
 *   await client.events.publish(topic, eventData);
 * });
 * ```
 */
export async function llmStream(
  ctx: WorkflowContext,
  llm: LLM,
  payload: LLMStreamPayload,
  publishEvent: PublishEventFn
): Promise<LLMGenerateResult> {
  const { agent_step, ...generateOptions } = payload;

  const topic = `workflow/${ctx.rootWorkflowId}/${ctx.rootExecutionId}`;
  const stepKey = `llm_stream:${String(agent_step)}`;

  const result = await ctx.step.run(
    stepKey,
    async () => {
      // Publish stream_start event directly (not via step)
      await publishEvent(topic, {
        eventType: 'stream_start',
        data: { step: agent_step },
      });

      let accumulatedContent = '';
      const accumulatedToolCalls: LLMToolCall[] = [];
      let finalUsage: LLMUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      let finalModel = getModelId(llm.model);
      let finalStopReason: string | null = null;
      let finalRawOutput: unknown[] | null = null;
      let chunkIndex = 0;

      for await (const event of llm.stream(generateOptions)) {
        switch (event.type) {
          case 'text_delta': {
            accumulatedContent += event.data.content;
            await publishEvent(topic, {
              eventType: 'text_delta',
              data: {
                step: agent_step,
                chunk_index: chunkIndex,
                content: event.data.content,
                _metadata: {
                  execution_id: ctx.executionId,
                  workflow_id: ctx.workflowId,
                },
              },
            });
            chunkIndex++;
            break;
          }
          case 'tool_call': {
            accumulatedToolCalls.push(event.data.tool_call);
            await publishEvent(topic, {
              eventType: 'tool_call',
              data: {
                step: agent_step,
                chunk_index: chunkIndex,
                tool_call: event.data.tool_call,
                _metadata: {
                  execution_id: ctx.executionId,
                  workflow_id: ctx.workflowId,
                },
              },
            });
            chunkIndex++;
            break;
          }
          case 'done': {
            finalUsage = event.data.usage;
            finalModel = event.data.model;
            finalStopReason = event.data.stop_reason;
            finalRawOutput = event.data.raw_output;
            break;
          }
          case 'error': {
            throw new Error(`LLM stream error: ${event.data.error}`);
          }
        }
      }

      return {
        content: accumulatedContent || null,
        usage: finalUsage,
        tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : null,
        raw_output: finalRawOutput,
        model: finalModel,
        stop_reason: finalStopReason,
        agent_run_id: ctx.executionId,
        status: 'completed',
      } satisfies LLMGenerateResult;
    },
    {
      input: {
        kwargs: {
          messages: generateOptions.messages,
          system: generateOptions.system,
          tools: generateOptions.tools,
          temperature: generateOptions.temperature,
          maxTokens: generateOptions.maxTokens,
        },
      },
    }
  );

  return result;
}
