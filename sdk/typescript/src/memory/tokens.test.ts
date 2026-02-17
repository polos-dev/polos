import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { estimateTokens, estimateMessageTokens, estimateMessagesTokens } from './tokens.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    assert.strictEqual(estimateTokens(''), 0);
  });

  it('returns ceil(length / 4) for non-empty string', () => {
    // 'hello world' = 11 chars → ceil(11/4) = 3
    assert.strictEqual(estimateTokens('hello world'), 3);
  });

  it('returns 1 for a single character', () => {
    assert.strictEqual(estimateTokens('a'), 1);
  });

  it('returns exact value for length divisible by 4', () => {
    // 'abcd' = 4 chars → ceil(4/4) = 1
    assert.strictEqual(estimateTokens('abcd'), 1);
    // 'abcdefgh' = 8 chars → ceil(8/4) = 2
    assert.strictEqual(estimateTokens('abcdefgh'), 2);
  });

  it('rounds up for non-divisible lengths', () => {
    // 'abc' = 3 chars → ceil(3/4) = 1
    assert.strictEqual(estimateTokens('abc'), 1);
    // 'abcde' = 5 chars → ceil(5/4) = 2
    assert.strictEqual(estimateTokens('abcde'), 2);
  });
});

describe('estimateMessageTokens', () => {
  it('estimates tokens for string content', () => {
    const msg = { role: 'user', content: 'hello world' };
    assert.strictEqual(estimateMessageTokens(msg), 3);
  });

  it('estimates tokens for object content via JSON.stringify', () => {
    const msg = { role: 'assistant', content: { key: 'value' } };
    // JSON.stringify({ key: 'value' }) = '{"key":"value"}' = 15 chars → ceil(15/4) = 4
    assert.strictEqual(
      estimateMessageTokens(msg),
      Math.ceil(JSON.stringify({ key: 'value' }).length / 4)
    );
  });

  it('estimates tokens for array content', () => {
    const msg = { role: 'user', content: [1, 2, 3] };
    // JSON.stringify([1,2,3]) = '[1,2,3]' = 7 chars → ceil(7/4) = 2
    assert.strictEqual(estimateMessageTokens(msg), Math.ceil(JSON.stringify([1, 2, 3]).length / 4));
  });

  it('returns 0 for empty string content', () => {
    const msg = { role: 'user', content: '' };
    assert.strictEqual(estimateMessageTokens(msg), 0);
  });
});

describe('estimateMessagesTokens', () => {
  it('returns 0 for empty array', () => {
    assert.strictEqual(estimateMessagesTokens([]), 0);
  });

  it('sums tokens across messages', () => {
    const messages = [
      { role: 'user', content: 'hello world' }, // 3 tokens
      { role: 'assistant', content: 'hi' }, // 1 token (ceil(2/4)=1)
    ];
    assert.strictEqual(estimateMessagesTokens(messages), 3 + 1);
  });

  it('handles mixed content types', () => {
    const messages = [
      { role: 'user', content: 'test' }, // ceil(4/4) = 1
      { role: 'assistant', content: { answer: 'yes' } }, // JSON stringified
    ];
    const expected = 1 + Math.ceil(JSON.stringify({ answer: 'yes' }).length / 4);
    assert.strictEqual(estimateMessagesTokens(messages), expected);
  });

  it('handles single message array', () => {
    const messages = [{ role: 'user', content: 'hello world' }];
    assert.strictEqual(estimateMessagesTokens(messages), 3);
  });
});
