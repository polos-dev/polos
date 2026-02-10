/**
 * StreamResult — wraps an ExecutionHandle + PolosClient to provide
 * streaming iteration over agent execution events.
 *
 * Matches Python sdk/python/polos/agents/agent.py StreamResult class.
 */

import type { ExecutionHandle } from '../execution-handle.js';
import type { PolosClient } from '../client.js';
import type { StreamEvent } from '../types/events.js';
import type { AgentStreamResult } from './stream.js';

/**
 * Result from streaming an agent execution.
 * Provides async iterables for text chunks and full events,
 * plus methods to accumulate text or wait for the final result.
 */
export class StreamResult {
  /** Execution ID */
  readonly id: string;
  /** Workflow ID */
  readonly workflowId: string;
  /** When the execution was created */
  readonly createdAt: string | undefined;
  /** Root workflow ID */
  readonly rootWorkflowId: string;
  /** Root execution ID */
  readonly rootExecutionId: string;
  /** Session ID */
  readonly sessionId: string | undefined;
  /** User ID */
  readonly userId: string | undefined;
  /** Agent run ID (same as execution ID) */
  readonly agentRunId: string;
  /** Event topic for this execution */
  readonly topic: string;

  private readonly handle: ExecutionHandle;
  private readonly client: PolosClient;

  constructor(handle: ExecutionHandle, client: PolosClient) {
    this.handle = handle;
    this.client = client;

    this.id = handle.id;
    this.workflowId = handle.workflowId;
    this.createdAt = handle.createdAt;
    this.rootWorkflowId = handle.rootWorkflowId;
    this.rootExecutionId = handle.rootExecutionId;
    this.sessionId = handle.sessionId;
    this.userId = handle.userId;

    // Computed fields matching Python
    this.agentRunId = handle.id;
    this.topic = `workflow/${handle.rootWorkflowId}/${handle.rootExecutionId}`;
  }

  /**
   * Async iterable of all SSE events from the workflow execution.
   * Matches Python FullEventIterator.
   */
  get events(): AsyncIterable<StreamEvent> {
    const client = this.client;
    const rootWorkflowId = this.rootWorkflowId;
    const rootExecutionId = this.rootExecutionId;

    // Use root IDs matching Python StreamResult._stream_events()
    return client.events.streamWorkflow(rootWorkflowId, rootExecutionId);
  }

  /**
   * Async iterable of text chunks only (filtering for text_delta events).
   * Matches Python TextChunkIterator.
   */
  get textChunks(): AsyncIterable<string> {
    const events = this.events;

    async function* filterTextChunks() {
      for await (const event of events) {
        if (event.eventType === 'text_delta') {
          const content = event.data['content'];
          if (typeof content === 'string' && content.length > 0) {
            yield content;
          }
        }
      }
    }

    return filterTextChunks();
  }

  /**
   * Accumulate all text chunks into a single string.
   * Matches Python StreamResult.text().
   */
  async text(): Promise<string> {
    let accumulated = '';
    for await (const chunk of this.textChunks) {
      accumulated += chunk;
    }
    return accumulated;
  }

  /**
   * Stream events and return the final AgentStreamResult when agent_finish is received.
   * Matches Python StreamResult.result().
   */
  async result(): Promise<AgentStreamResult> {
    const rootExecutionId = this.rootExecutionId;

    for await (const event of this.events) {
      if (event.eventType === 'agent_finish') {
        const metadata = event.data['_metadata'];
        if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
          const metadataRecord = metadata as Record<string, unknown>;
          if (metadataRecord['execution_id'] === rootExecutionId) {
            return event.data as unknown as AgentStreamResult;
          }
        }
      }
    }

    // If the stream ends without an agent_finish event, fall back to polling
    return (await this.handle.getResult()) as AgentStreamResult;
  }

  /**
   * Get the current execution status and details.
   * Delegates to the underlying ExecutionHandle.
   */
  async get() {
    return this.handle.get();
  }
}
