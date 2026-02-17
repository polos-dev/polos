/**
 * Memory module — session compaction for long-running agent conversations.
 */

export type {
  SessionMemory,
  CompactionConfig,
  NormalizedCompactionConfig,
  CompactionResult,
} from './types.js';

export { estimateTokens, estimateMessageTokens, estimateMessagesTokens } from './tokens.js';

export {
  COMPACTION_PROMPT,
  SUMMARY_USER_PREFIX,
  SUMMARY_ASSISTANT_ACK,
  buildSummaryMessages,
  isSummaryPair,
  compactIfNeeded,
} from './compaction.js';
