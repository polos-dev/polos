/**
 * Core session compaction logic.
 *
 * Compacts older conversation messages into a rolling summary via an LLM call,
 * keeping the last N recent messages verbatim.
 */

import { generateText } from 'ai';
import type { ConversationMessage } from '../runtime/orchestrator-types.js';
import type { NormalizedCompactionConfig, CompactionResult } from './types.js';
import { estimateTokens, estimateMessagesTokens } from './tokens.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ name: 'memory-compaction' });

// ── Constants ────────────────────────────────────────────────────────

export const COMPACTION_PROMPT = `You are summarizing a conversation between a user and an AI assistant.

Your goal: someone reading only this summary should be able to continue the conversation without the user having to repeat themselves.

Capture:
- What the user is trying to accomplish (their goal, problem, or question)
- Key facts, context, or constraints the user shared (personal details, preferences, requirements, deadlines)
- Decisions made or conclusions reached
- Recommendations given and whether the user accepted, rejected, or is still considering them
- Any specific artifacts produced (code, files, plans, drafts, lists — include names and key details)
- Open threads — anything unresolved, in progress, or that the user said they'd come back to
- The current state of the conversation (where things left off)

Existing summary (if any):
{existing_summary}

New messages to fold into the summary:
{messages_to_fold}

Write a concise summary in short paragraphs grouped by topic. Not bullet points — narrative that flows.
Be factual and specific. No pleasantries, no meta-commentary, no "the user and assistant discussed..."
Write as if taking notes for a colleague who needs to pick up this conversation.`;

export const SUMMARY_USER_PREFIX = '[Prior conversation summary]\n';
export const SUMMARY_ASSISTANT_ACK = 'Understood, I have context from our earlier conversation.';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build the user/assistant summary pair to inject at the start of conversation.
 */
export function buildSummaryMessages(summary: string): [ConversationMessage, ConversationMessage] {
  return [
    { role: 'user', content: SUMMARY_USER_PREFIX + summary },
    { role: 'assistant', content: SUMMARY_ASSISTANT_ACK },
  ];
}

/**
 * Detect whether messages[index] and messages[index+1] form a summary pair.
 */
export function isSummaryPair(messages: ConversationMessage[], index: number): boolean {
  if (index + 1 >= messages.length) return false;
  const userMsg = messages[index];
  const assistantMsg = messages[index + 1];
  if (!userMsg || !assistantMsg) return false;
  if (userMsg.role !== 'user' || assistantMsg.role !== 'assistant') return false;
  const userContent = typeof userMsg.content === 'string' ? userMsg.content : '';
  const assistantContent = typeof assistantMsg.content === 'string' ? assistantMsg.content : '';
  return userContent.startsWith(SUMMARY_USER_PREFIX) && assistantContent === SUMMARY_ASSISTANT_ACK;
}

/**
 * Format messages as text for inclusion in the compaction prompt.
 */
function formatMessagesForPrompt(messages: ConversationMessage[]): string {
  return messages
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${m.role}: ${content}`;
    })
    .join('\n\n');
}

// ── Main function ────────────────────────────────────────────────────

/**
 * Compact conversation messages if they exceed the token budget.
 *
 * 1. Estimate total tokens of all messages
 * 2. If under maxConversationTokens -> return as-is (no-op)
 * 3. Otherwise:
 *    - Find summary pair at start (if present)
 *    - Determine messages to fold (between summary pair and last minRecentMessages)
 *    - Call compaction model to generate summary
 *    - If summary exceeds maxSummaryTokens, re-summarize
 *    - Replace folded messages + old summary pair with new summary pair
 * 4. On failure -> log warning, fall back to naive truncation
 */
export async function compactIfNeeded(
  messages: ConversationMessage[],
  currentSummary: string | null,
  config: NormalizedCompactionConfig
): Promise<CompactionResult> {
  const totalTokens = estimateMessagesTokens(messages);

  // Under budget — no-op
  if (totalTokens <= config.maxConversationTokens) {
    return {
      compacted: false,
      messages,
      summary: currentSummary,
      summaryTokens: currentSummary ? estimateTokens(currentSummary) : 0,
      totalTurns: messages.length,
    };
  }

  // Determine summary pair boundaries
  let summaryPairEnd = 0;
  if (messages.length >= 2 && isSummaryPair(messages, 0)) {
    summaryPairEnd = 2;
  }

  // Messages available for folding: everything between summary pair and recent window
  const recentStart = Math.max(summaryPairEnd, messages.length - config.minRecentMessages);

  // Nothing to fold
  if (recentStart <= summaryPairEnd) {
    return {
      compacted: false,
      messages,
      summary: currentSummary,
      summaryTokens: currentSummary ? estimateTokens(currentSummary) : 0,
      totalTurns: messages.length,
    };
  }

  const messagesToFold = messages.slice(summaryPairEnd, recentStart);
  const recentMessages = messages.slice(recentStart);

  // Nothing to fold (e.g., single message)
  if (messagesToFold.length === 0) {
    return {
      compacted: false,
      messages,
      summary: currentSummary,
      summaryTokens: currentSummary ? estimateTokens(currentSummary) : 0,
      totalTurns: messages.length,
    };
  }

  try {
    // Build the compaction prompt
    const existingSummary = currentSummary ?? '(none)';
    const foldedText = formatMessagesForPrompt(messagesToFold);
    const prompt = COMPACTION_PROMPT.replace('{existing_summary}', existingSummary).replace(
      '{messages_to_fold}',
      foldedText
    );

    // Call compaction model
    let summary = await callCompactionModel(config, prompt);

    // Re-summarize if summary is too long
    if (estimateTokens(summary) > config.maxSummaryTokens) {
      const reSummarizePrompt = COMPACTION_PROMPT.replace('{existing_summary}', '(none)').replace(
        '{messages_to_fold}',
        `The following is a summary that needs to be shortened:\n\n${summary}`
      );
      summary = await callCompactionModel(config, reSummarizePrompt);
    }

    // Build new messages array: [summary pair] + [recent messages]
    const [summaryUser, summaryAssistant] = buildSummaryMessages(summary);
    const newMessages: ConversationMessage[] = [summaryUser, summaryAssistant, ...recentMessages];

    return {
      compacted: true,
      messages: newMessages,
      summary,
      summaryTokens: estimateTokens(summary),
      totalTurns: messages.length,
    };
  } catch (err) {
    logger.warn('Compaction failed, falling back to naive truncation', { error: String(err) });

    // Fallback: keep last minRecentMessages
    const fallbackMessages = messages.slice(-config.minRecentMessages);
    return {
      compacted: true,
      messages: fallbackMessages,
      summary: currentSummary,
      summaryTokens: currentSummary ? estimateTokens(currentSummary) : 0,
      totalTurns: messages.length,
    };
  }
}

/**
 * Call the compaction model to generate a summary.
 */
async function callCompactionModel(
  config: NormalizedCompactionConfig,
  prompt: string
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await generateText({
    model: config.compactionModel,
    messages: [{ role: 'user', content: prompt }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return result.text;
}
