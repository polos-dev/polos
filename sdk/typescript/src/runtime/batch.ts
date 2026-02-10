/**
 * Batch workflow triggering utilities.
 *
 * Matches Python sdk/python/polos/runtime/batch.py.
 */

import type { PolosClient, ClientBatchWorkflowInput } from '../client.js';
import type { ExecutionHandle } from '../execution-handle.js';
import { AgentRunConfig } from '../core/step.js';
import { assertNotInExecutionContext } from './execution-context.js';

// Re-export AgentRunConfig so existing imports from this module still work
export { AgentRunConfig };

/**
 * Invoke multiple different workflows in a single batch and return handles immediately.
 *
 * This function cannot be called from within a workflow or agent.
 * Use step.batchInvoke() to call workflows from within workflows.
 *
 * Matches Python batch_invoke().
 */
export async function batchInvoke(
  client: PolosClient,
  workflows: ClientBatchWorkflowInput[],
  sessionId?: string,
  userId?: string
): Promise<ExecutionHandle[]> {
  assertNotInExecutionContext('batchInvoke()', 'step.batchInvoke()');

  return client.batchInvoke(workflows, {
    ...(sessionId !== undefined && { sessionId }),
    ...(userId !== undefined && { userId }),
  });
}

/**
 * Invoke multiple agents in parallel and return execution handles.
 *
 * This helper is intended for use with agent.withInput(), which returns
 * AgentRunConfig instances.
 *
 * Matches Python batch_agent_invoke().
 *
 * @example
 * ```typescript
 * const handles = await batchAgentInvoke(client, [
 *   grammarAgent.withInput("Check this"),
 *   toneAgent.withInput("Check this too"),
 * ]);
 * ```
 */
export async function batchAgentInvoke(
  client: PolosClient,
  agents: AgentRunConfig[]
): Promise<ExecutionHandle[]> {
  const workflows: ClientBatchWorkflowInput[] = agents.map((config) => ({
    workflow: config.agent,
    payload: {
      input: config.input,
      streaming: config.streaming,
      session_id: config.sessionId,
      conversation_id: config.conversationId,
      user_id: config.userId,
      ...config.kwargs,
    },
    initialState: config.initialState,
    runTimeoutSeconds: config.runTimeoutSeconds,
  }));

  return batchInvoke(client, workflows);
}
