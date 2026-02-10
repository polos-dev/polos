import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { calculateDelay, retry, createRetry } from './retry.js';

describe('calculateDelay', () => {
  it('computes exponential backoff without jitter', () => {
    const opts = { baseDelay: 1000, maxDelay: 30000, backoffMultiplier: 2, jitter: false };
    assert.strictEqual(calculateDelay(0, opts), 1000); // 1000 * 2^0
    assert.strictEqual(calculateDelay(1, opts), 2000); // 1000 * 2^1
    assert.strictEqual(calculateDelay(2, opts), 4000); // 1000 * 2^2
    assert.strictEqual(calculateDelay(3, opts), 8000); // 1000 * 2^3
  });

  it('caps at maxDelay', () => {
    const opts = { baseDelay: 1000, maxDelay: 5000, backoffMultiplier: 2, jitter: false };
    assert.strictEqual(calculateDelay(10, opts), 5000);
  });

  it('adds jitter within ±25% bounds', () => {
    const opts = { baseDelay: 1000, maxDelay: 30000, backoffMultiplier: 2, jitter: true };
    // Run multiple times to check bounds
    for (let i = 0; i < 50; i++) {
      const delay = calculateDelay(0, opts);
      // base = 1000, jitter ±25% → [750, 1250]
      assert.ok(delay >= 750, `delay ${delay} should be >= 750`);
      assert.ok(delay <= 1250, `delay ${delay} should be <= 1250`);
    }
  });

  it('uses defaults when options are omitted', () => {
    const delay = calculateDelay(0, { jitter: false });
    assert.strictEqual(delay, 1000); // default baseDelay
  });
});

describe('retry', () => {
  it('returns result on first successful try', async () => {
    const fn = mock.fn(() => 42);
    const result = await retry(fn, { maxRetries: 3, baseDelay: 1, jitter: false });
    assert.strictEqual(result, 42);
    assert.strictEqual(fn.mock.callCount(), 1);
  });

  it('retries and succeeds on later attempt', async () => {
    let attempt = 0;
    const fn = () => {
      attempt++;
      if (attempt < 3) throw new Error('fail');
      return 'ok';
    };
    const result = await retry(fn, { maxRetries: 3, baseDelay: 1, jitter: false });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(attempt, 3);
  });

  it('throws last error when retries are exhausted', async () => {
    const fn = () => {
      throw new Error('always fails');
    };
    await assert.rejects(() => retry(fn, { maxRetries: 2, baseDelay: 1, jitter: false }), {
      message: 'always fails',
    });
  });

  it('respects isRetryable — stops on non-retryable errors', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      throw new Error('not retryable');
    };
    await assert.rejects(
      () =>
        retry(fn, {
          maxRetries: 5,
          baseDelay: 1,
          jitter: false,
          isRetryable: () => false,
        }),
      { message: 'not retryable' }
    );
    assert.strictEqual(calls, 1);
  });

  it('calls onRetry callback before each retry', async () => {
    let attempt = 0;
    const retryLog: { attempt: number; delay: number }[] = [];
    const fn = () => {
      attempt++;
      if (attempt < 3) throw new Error('fail');
      return 'done';
    };
    await retry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      jitter: false,
      onRetry: (_err, att, delay) => {
        retryLog.push({ attempt: att, delay });
      },
    });
    assert.strictEqual(retryLog.length, 2);
    assert.strictEqual(retryLog[0]?.attempt, 1);
    assert.strictEqual(retryLog[1]?.attempt, 2);
  });
});

describe('createRetry', () => {
  it('applies preset defaults', async () => {
    let calls = 0;
    const retryFn = createRetry({ maxRetries: 1, baseDelay: 1, jitter: false });
    const fn = () => {
      calls++;
      if (calls < 2) throw new Error('fail');
      return 'ok';
    };
    const result = await retryFn(fn);
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 2);
  });

  it('allows overriding defaults per call', async () => {
    const retryFn = createRetry({ maxRetries: 10, baseDelay: 1, jitter: false });
    let calls = 0;
    const fn = () => {
      calls++;
      throw new Error('fail');
    };
    await assert.rejects(() => retryFn(fn, { maxRetries: 0 }), { message: 'fail' });
    assert.strictEqual(calls, 1);
  });
});
