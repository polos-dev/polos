import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LanguageModel } from 'ai';

import { applyAnthropicCacheControl, isAnthropicModel, ANTHROPIC_CACHE_BREAKPOINT } from './llm.js';

/** Create a minimal mock LanguageModel with the given provider. */
function mockModel(provider: string): LanguageModel {
  return { provider, modelId: 'test-model' } as LanguageModel;
}

describe('isAnthropicModel', () => {
  it('returns true for provider starting with "anthropic"', () => {
    assert.strictEqual(isAnthropicModel(mockModel('anthropic')), true);
    assert.strictEqual(isAnthropicModel(mockModel('anthropic.messages')), true);
  });

  it('returns false for non-Anthropic providers', () => {
    assert.strictEqual(isAnthropicModel(mockModel('openai')), false);
    assert.strictEqual(isAnthropicModel(mockModel('google')), false);
  });
});

describe('applyAnthropicCacheControl', () => {
  it('does nothing for non-Anthropic models', () => {
    const args: Record<string, unknown> = {
      model: mockModel('openai'),
      system: 'You are helpful.',
      tools: { search: { description: 'search' } },
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const before = JSON.parse(JSON.stringify(args));
    applyAnthropicCacheControl(args, mockModel('openai'));

    assert.strictEqual(args['system'], before['system']);
    assert.deepStrictEqual(args['tools'], before['tools']);
    assert.deepStrictEqual(args['messages'], before['messages']);
  });

  it('converts system string to SystemModelMessage with cache control', () => {
    const args: Record<string, unknown> = {
      system: 'You are a helpful assistant.',
      messages: [],
    };

    applyAnthropicCacheControl(args, mockModel('anthropic'));

    assert.deepStrictEqual(args['system'], {
      role: 'system',
      content: 'You are a helpful assistant.',
      providerOptions: ANTHROPIC_CACHE_BREAKPOINT,
    });
  });

  it('adds cache control to the last tool', () => {
    const args: Record<string, unknown> = {
      tools: {
        search: { description: 'Search the web' },
        calculate: { description: 'Do math' },
      },
      messages: [],
    };

    applyAnthropicCacheControl(args, mockModel('anthropic'));

    const tools = args['tools'] as Record<string, Record<string, unknown>>;
    // First tool should be unchanged
    assert.strictEqual(tools['search']!['providerOptions'], undefined);
    // Last tool should have cache control
    assert.deepStrictEqual(tools['calculate']!['providerOptions'], ANTHROPIC_CACHE_BREAKPOINT);
  });

  it('adds cache control to a single tool', () => {
    const args: Record<string, unknown> = {
      tools: {
        search: { description: 'Search' },
      },
      messages: [],
    };

    applyAnthropicCacheControl(args, mockModel('anthropic'));

    const tools = args['tools'] as Record<string, Record<string, unknown>>;
    assert.deepStrictEqual(tools['search']!['providerOptions'], ANTHROPIC_CACHE_BREAKPOINT);
  });

  it('adds cache control to the last message', () => {
    const args: Record<string, unknown> = {
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ],
    };

    applyAnthropicCacheControl(args, mockModel('anthropic'));

    const messages = args['messages'] as Array<Record<string, unknown>>;
    // First two messages unchanged
    assert.strictEqual(messages[0]!['providerOptions'], undefined);
    assert.strictEqual(messages[1]!['providerOptions'], undefined);
    // Last message gets cache control
    assert.deepStrictEqual(messages[2]!['providerOptions'], ANTHROPIC_CACHE_BREAKPOINT);
  });

  it('handles missing system, tools, and messages without error', () => {
    const args: Record<string, unknown> = {};

    // Should not throw
    applyAnthropicCacheControl(args, mockModel('anthropic'));

    assert.strictEqual(args['system'], undefined);
    assert.strictEqual(args['tools'], undefined);
    assert.strictEqual(args['messages'], undefined);
  });

  it('handles empty messages array without error', () => {
    const args: Record<string, unknown> = {
      messages: [],
    };

    applyAnthropicCacheControl(args, mockModel('anthropic'));

    assert.deepStrictEqual(args['messages'], []);
  });

  it('handles empty tools object without error', () => {
    const args: Record<string, unknown> = {
      tools: {},
      messages: [],
    };

    applyAnthropicCacheControl(args, mockModel('anthropic'));

    assert.deepStrictEqual(args['tools'], {});
  });

  it('applies all three cache breakpoints together', () => {
    const args: Record<string, unknown> = {
      system: 'Be helpful.',
      tools: {
        search: { description: 'Search' },
        calc: { description: 'Calculate' },
      },
      messages: [{ role: 'user', content: 'Hello' }],
    };

    applyAnthropicCacheControl(args, mockModel('anthropic'));

    // System converted
    assert.deepStrictEqual(args['system'], {
      role: 'system',
      content: 'Be helpful.',
      providerOptions: ANTHROPIC_CACHE_BREAKPOINT,
    });

    // Last tool marked
    const tools = args['tools'] as Record<string, Record<string, unknown>>;
    assert.strictEqual(tools['search']!['providerOptions'], undefined);
    assert.deepStrictEqual(tools['calc']!['providerOptions'], ANTHROPIC_CACHE_BREAKPOINT);

    // Last message marked
    const messages = args['messages'] as Array<Record<string, unknown>>;
    assert.deepStrictEqual(messages[0]!['providerOptions'], ANTHROPIC_CACHE_BREAKPOINT);
  });
});
