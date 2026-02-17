/**
 * Token estimation utilities for session compaction.
 *
 * Uses a simple heuristic: ~4 characters per token.
 */

import type { ConversationMessage } from '../runtime/orchestrator-types.js';

/**
 * Estimate token count for a string using the ~4 chars/token heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate token count for a single conversation message.
 */
export function estimateMessageTokens(message: ConversationMessage): number {
  const content = message.content;
  if (typeof content === 'string') {
    return estimateTokens(content);
  }
  try {
    return estimateTokens(JSON.stringify(content));
  } catch {
    return 0;
  }
}

/**
 * Estimate total token count for an array of conversation messages.
 */
export function estimateMessagesTokens(messages: ConversationMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}
