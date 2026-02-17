import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LanguageModel } from 'ai';

import {
  COMPACTION_PROMPT,
  SUMMARY_USER_PREFIX,
  SUMMARY_ASSISTANT_ACK,
  buildSummaryMessages,
  isSummaryPair,
  compactIfNeeded,
} from './compaction.js';
import type { NormalizedCompactionConfig } from './types.js';
import type { ConversationMessage } from '../runtime/orchestrator-types.js';

// ── Mock model ───────────────────────────────────────────────────────

/**
 * Build a v3 LanguageModel doGenerate result that returns the given text.
 */
function makeDoGenerateResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
    rawCall: { rawPrompt: '', rawSettings: {} },
    response: { id: 'test-id', modelId: 'test', timestamp: new Date() },
    sources: [],
    providerMetadata: {},
  };
}

/**
 * Create a mock LanguageModel (v3 spec) that returns the given text from generateText().
 */
function createMockModel(responseText: string): LanguageModel {
  return {
    specificationVersion: 'v3' as const,
    provider: 'test-provider',
    modelId: 'test-compaction-model',
    doGenerate: async () => makeDoGenerateResult(responseText),
    doStream: async () => ({
      stream: new ReadableStream(),
      rawCall: { rawPrompt: '', rawSettings: {} },
    }),
  } as unknown as LanguageModel;
}

/**
 * Create a mock model that throws on generate (to test error paths).
 */
function createFailingModel(): LanguageModel {
  return {
    specificationVersion: 'v3' as const,
    provider: 'test-provider',
    modelId: 'test-failing-model',
    doGenerate: async () => {
      throw new Error('LLM call failed');
    },
    doStream: async () => {
      throw new Error('LLM call failed');
    },
  } as unknown as LanguageModel;
}

/**
 * Build a default NormalizedCompactionConfig for testing.
 */
function makeConfig(overrides?: Partial<NormalizedCompactionConfig>): NormalizedCompactionConfig {
  return {
    maxConversationTokens: 100,
    maxSummaryTokens: 50,
    minRecentMessages: 4,
    compactionModel: createMockModel('This is a compacted summary.'),
    enabled: true,
    ...overrides,
  };
}

/**
 * Generate a long message to exceed token budgets.
 * estimateTokens uses ceil(length/4), so 400 chars ≈ 100 tokens.
 */
function longContent(tokens: number): string {
  return 'x'.repeat(tokens * 4);
}

// ── Constants ────────────────────────────────────────────────────────

describe('COMPACTION_PROMPT', () => {
  it('contains placeholder for existing summary', () => {
    assert.ok(COMPACTION_PROMPT.includes('{existing_summary}'));
  });

  it('contains placeholder for messages to fold', () => {
    assert.ok(COMPACTION_PROMPT.includes('{messages_to_fold}'));
  });
});

describe('SUMMARY_USER_PREFIX', () => {
  it('starts with [Prior conversation summary]', () => {
    assert.ok(SUMMARY_USER_PREFIX.startsWith('[Prior conversation summary]'));
  });
});

describe('SUMMARY_ASSISTANT_ACK', () => {
  it('is a non-empty string', () => {
    assert.ok(SUMMARY_ASSISTANT_ACK.length > 0);
  });
});

// ── buildSummaryMessages ─────────────────────────────────────────────

describe('buildSummaryMessages', () => {
  it('returns a user/assistant pair', () => {
    const [user, assistant] = buildSummaryMessages('test summary');
    assert.strictEqual(user.role, 'user');
    assert.strictEqual(assistant.role, 'assistant');
  });

  it('user message starts with SUMMARY_USER_PREFIX', () => {
    const [user] = buildSummaryMessages('test summary');
    assert.ok((user.content as string).startsWith(SUMMARY_USER_PREFIX));
  });

  it('user message contains the summary text', () => {
    const [user] = buildSummaryMessages('my important summary');
    assert.ok((user.content as string).includes('my important summary'));
  });

  it('assistant message is the acknowledgment', () => {
    const [, assistant] = buildSummaryMessages('test summary');
    assert.strictEqual(assistant.content, SUMMARY_ASSISTANT_ACK);
  });
});

// ── isSummaryPair ────────────────────────────────────────────────────

describe('isSummaryPair', () => {
  it('returns true for a valid summary pair', () => {
    const [user, assistant] = buildSummaryMessages('some summary');
    const messages: ConversationMessage[] = [user, assistant];
    assert.strictEqual(isSummaryPair(messages, 0), true);
  });

  it('returns false when index is out of bounds', () => {
    const messages: ConversationMessage[] = [{ role: 'user', content: 'hi' }];
    assert.strictEqual(isSummaryPair(messages, 0), false);
  });

  it('returns false for regular user/assistant messages', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    assert.strictEqual(isSummaryPair(messages, 0), false);
  });

  it('returns false when roles are wrong', () => {
    const messages: ConversationMessage[] = [
      { role: 'assistant', content: SUMMARY_USER_PREFIX + 'summary' },
      { role: 'user', content: SUMMARY_ASSISTANT_ACK },
    ];
    assert.strictEqual(isSummaryPair(messages, 0), false);
  });

  it('returns false when user content does not start with prefix', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'not a summary' },
      { role: 'assistant', content: SUMMARY_ASSISTANT_ACK },
    ];
    assert.strictEqual(isSummaryPair(messages, 0), false);
  });

  it('returns false when assistant content does not match ack', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: SUMMARY_USER_PREFIX + 'summary' },
      { role: 'assistant', content: 'something else' },
    ];
    assert.strictEqual(isSummaryPair(messages, 0), false);
  });

  it('detects summary pair at non-zero index', () => {
    const [summaryUser, summaryAssistant] = buildSummaryMessages('summary');
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'earlier message' },
      summaryUser,
      summaryAssistant,
    ];
    assert.strictEqual(isSummaryPair(messages, 0), false);
    assert.strictEqual(isSummaryPair(messages, 1), true);
  });

  it('returns false for non-string content', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: { text: SUMMARY_USER_PREFIX + 'summary' } },
      { role: 'assistant', content: SUMMARY_ASSISTANT_ACK },
    ];
    assert.strictEqual(isSummaryPair(messages, 0), false);
  });
});

// ── compactIfNeeded ──────────────────────────────────────────────────

describe('compactIfNeeded', () => {
  it('returns no-op when under budget', async () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const config = makeConfig({ maxConversationTokens: 1000 });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.compacted, false);
    assert.strictEqual(result.messages, messages); // same reference
    assert.strictEqual(result.summary, null);
  });

  it('returns no-op for single message even if over budget', async () => {
    // Single message can't be folded (minRecentMessages=4 > 1 message)
    const messages: ConversationMessage[] = [{ role: 'user', content: longContent(200) }];
    const config = makeConfig({ maxConversationTokens: 10 });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.compacted, false);
    assert.strictEqual(result.messages, messages);
  });

  it('returns no-op when all messages are within minRecentMessages', async () => {
    // 4 messages with minRecentMessages=4 → nothing to fold
    const messages: ConversationMessage[] = [
      { role: 'user', content: longContent(30) },
      { role: 'assistant', content: longContent(30) },
      { role: 'user', content: longContent(30) },
      { role: 'assistant', content: longContent(30) },
    ];
    const config = makeConfig({ maxConversationTokens: 10, minRecentMessages: 4 });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.compacted, false);
  });

  it('compacts when over budget with enough messages', async () => {
    // 8 messages, minRecentMessages=2
    // Messages 0-5 should be folded, messages 6-7 kept
    const messages: ConversationMessage[] = [
      { role: 'user', content: longContent(20) },
      { role: 'assistant', content: longContent(20) },
      { role: 'user', content: longContent(20) },
      { role: 'assistant', content: longContent(20) },
      { role: 'user', content: longContent(20) },
      { role: 'assistant', content: longContent(20) },
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ];
    const config = makeConfig({
      maxConversationTokens: 10,
      minRecentMessages: 2,
    });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.compacted, true);
    assert.ok(result.summary !== null);
    // Should have: [summary user, summary assistant, recent user, recent assistant] = 4 messages
    assert.strictEqual(result.messages.length, 4);
    // First two should be a summary pair
    assert.strictEqual(isSummaryPair(result.messages, 0), true);
    // Last two should be the recent messages
    assert.strictEqual(result.messages[2]?.content, 'recent question');
    assert.strictEqual(result.messages[3]?.content, 'recent answer');
  });

  it('preserves minRecentMessages during compaction', async () => {
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: longContent(20),
      });
    }
    const config = makeConfig({
      maxConversationTokens: 10,
      minRecentMessages: 4,
    });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.compacted, true);
    // Should have summary pair (2) + minRecentMessages (4) = 6
    assert.strictEqual(result.messages.length, 6);
    // Last 4 should be the original last 4 messages
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(result.messages[i + 2], messages[messages.length - 4 + i]);
    }
  });

  it('detects and replaces existing summary pair', async () => {
    const [existingSummaryUser, existingSummaryAssistant] = buildSummaryMessages('old summary');
    const messages: ConversationMessage[] = [
      existingSummaryUser,
      existingSummaryAssistant,
      { role: 'user', content: longContent(30) },
      { role: 'assistant', content: longContent(30) },
      { role: 'user', content: longContent(30) },
      { role: 'assistant', content: longContent(30) },
      { role: 'user', content: 'latest question' },
      { role: 'assistant', content: 'latest answer' },
    ];
    const config = makeConfig({
      maxConversationTokens: 10,
      minRecentMessages: 2,
    });

    const result = await compactIfNeeded(messages, 'old summary', config);

    assert.strictEqual(result.compacted, true);
    // Summary pair (2) + recent (2) = 4
    assert.strictEqual(result.messages.length, 4);
    assert.strictEqual(isSummaryPair(result.messages, 0), true);
    // Old summary should be replaced with new one
    assert.notStrictEqual(result.summary, 'old summary');
    assert.strictEqual(result.messages[2]?.content, 'latest question');
    assert.strictEqual(result.messages[3]?.content, 'latest answer');
  });

  it('re-summarizes when summary exceeds maxSummaryTokens', async () => {
    // First call returns a very long summary, second call returns a short one
    let callCount = 0;
    const model = {
      specificationVersion: 'v3' as const,
      provider: 'test-provider',
      modelId: 'test-model',
      doGenerate: async () => {
        callCount++;
        // First call returns a long summary (200 tokens = 800 chars)
        // Second call returns a short one
        const text = callCount === 1 ? longContent(200) : 'short re-summarized';
        return makeDoGenerateResult(text);
      },
      doStream: async () => ({
        stream: new ReadableStream(),
        rawCall: { rawPrompt: '', rawSettings: {} },
      }),
    } as unknown as LanguageModel;

    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: longContent(20),
      });
    }

    const config = makeConfig({
      maxConversationTokens: 10,
      maxSummaryTokens: 50,
      minRecentMessages: 2,
      compactionModel: model,
    });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.compacted, true);
    assert.strictEqual(callCount, 2); // generateText called twice (original + re-summarize)
    assert.strictEqual(result.summary, 'short re-summarized');
  });

  it('falls back to naive truncation on model failure', async () => {
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: longContent(20),
      });
    }

    const config = makeConfig({
      maxConversationTokens: 10,
      minRecentMessages: 4,
      compactionModel: createFailingModel(),
    });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.compacted, true);
    // Should keep last minRecentMessages
    assert.strictEqual(result.messages.length, 4);
    // Messages should be the last 4 from original
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(result.messages[i], messages[messages.length - 4 + i]);
    }
    // Summary unchanged (null in this case)
    assert.strictEqual(result.summary, null);
  });

  it('preserves existing summary on fallback', async () => {
    const [summaryUser, summaryAssistant] = buildSummaryMessages('existing summary');
    const messages: ConversationMessage[] = [
      summaryUser,
      summaryAssistant,
      ...Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : ('assistant' as string),
        content: longContent(20),
      })),
    ];

    const config = makeConfig({
      maxConversationTokens: 10,
      minRecentMessages: 2,
      compactionModel: createFailingModel(),
    });

    const result = await compactIfNeeded(messages, 'existing summary', config);

    assert.strictEqual(result.compacted, true);
    // Falls back to keeping last minRecentMessages
    assert.strictEqual(result.messages.length, 2);
    assert.strictEqual(result.summary, 'existing summary');
  });

  it('returns correct summaryTokens after compaction', async () => {
    const summaryText = 'This is a compacted summary.';
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: longContent(20),
      });
    }
    const config = makeConfig({
      maxConversationTokens: 10,
      minRecentMessages: 2,
      compactionModel: createMockModel(summaryText),
    });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.compacted, true);
    assert.strictEqual(result.summaryTokens, Math.ceil(summaryText.length / 4));
  });

  it('returns totalTurns equal to original message count', async () => {
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: longContent(20),
      });
    }
    const config = makeConfig({
      maxConversationTokens: 10,
      minRecentMessages: 2,
    });

    const result = await compactIfNeeded(messages, null, config);

    assert.strictEqual(result.totalTurns, 8);
  });
});
