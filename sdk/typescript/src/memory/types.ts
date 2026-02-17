/**
 * Types for the session compaction memory system.
 *
 * Two-tier memory:
 * - Tier 1: Rolling summary of older messages (compacted via LLM)
 * - Tier 2: Recent raw messages kept verbatim
 */

import type { LanguageModel } from 'ai';
import type { ConversationMessage } from '../runtime/orchestrator-types.js';

/**
 * Full session memory state.
 */
export interface SessionMemory {
  /** Compacted summary of older messages, or null if no compaction has occurred */
  summary: string | null;
  /** Recent messages kept verbatim */
  messages: ConversationMessage[];
}

/**
 * User-facing compaction configuration.
 */
export interface CompactionConfig {
  /** Maximum total conversation tokens before compaction triggers (default: 80000) */
  maxConversationTokens?: number | undefined;
  /** Maximum tokens for the summary (default: 20000) */
  maxSummaryTokens?: number | undefined;
  /** Minimum recent messages to always keep verbatim (default: 4) */
  minRecentMessages?: number | undefined;
  /** Model to use for compaction (default: agent's own model) */
  compactionModel?: LanguageModel | undefined;
  /** Whether compaction is enabled (default: true) */
  enabled?: boolean | undefined;
}

/**
 * Internal — all fields resolved to concrete values.
 */
export interface NormalizedCompactionConfig {
  maxConversationTokens: number;
  maxSummaryTokens: number;
  minRecentMessages: number;
  compactionModel: LanguageModel;
  enabled: boolean;
}

/**
 * Result from compactIfNeeded.
 */
export interface CompactionResult {
  /** Whether compaction was performed */
  compacted: boolean;
  /** The (possibly shortened) messages array */
  messages: ConversationMessage[];
  /** The current summary text (null if no summary) */
  summary: string | null;
  /** Estimated token count of the summary */
  summaryTokens: number;
  /** Total conversation turns */
  totalTurns: number;
}
