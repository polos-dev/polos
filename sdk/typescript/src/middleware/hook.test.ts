import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  defineHook,
  normalizeHook,
  normalizeHooks,
  isHook,
  HookResult,
  type Hook,
  type HookHandler,
  type HookResultType,
} from './hook.js';

describe('defineHook', () => {
  it('creates a hook with handler', () => {
    const handler: HookHandler = async () => HookResult.continue();
    const hook = defineHook(handler);
    assert.strictEqual(hook.handler, handler);
    assert.strictEqual(hook.name, undefined);
    assert.strictEqual(hook.description, undefined);
  });

  it('creates a hook with name and description', () => {
    const handler: HookHandler = async () => HookResult.continue();
    const hook = defineHook(handler, { name: 'my-hook', description: 'Does things' });
    assert.strictEqual(hook.name, 'my-hook');
    assert.strictEqual(hook.description, 'Does things');
  });
});

describe('isHook', () => {
  it('returns true for Hook objects', () => {
    const hook: Hook = { handler: async () => HookResult.continue() };
    assert.strictEqual(isHook(hook), true);
  });

  it('returns false for plain functions', () => {
    const fn: HookHandler = async () => HookResult.continue();
    assert.strictEqual(isHook(fn), false);
  });

  it('returns false for non-objects', () => {
    assert.strictEqual(isHook(null), false);
    assert.strictEqual(isHook(undefined), false);
    assert.strictEqual(isHook(42), false);
    assert.strictEqual(isHook('string'), false);
  });

  it('returns false for objects without handler function', () => {
    assert.strictEqual(isHook({ handler: 'not a function' }), false);
    assert.strictEqual(isHook({ name: 'test' }), false);
  });
});

describe('normalizeHook', () => {
  it('returns Hook objects unchanged', () => {
    const hook: Hook = { handler: async () => HookResult.continue(), name: 'test' };
    const normalized = normalizeHook(hook);
    assert.strictEqual(normalized, hook);
  });

  it('wraps bare handler function into Hook', () => {
    const fn: HookHandler = async () => HookResult.continue();
    const normalized = normalizeHook(fn);
    assert.strictEqual(normalized.handler, fn);
    assert.strictEqual(normalized.name, undefined);
  });
});

describe('normalizeHooks', () => {
  it('returns empty array for undefined', () => {
    assert.deepStrictEqual(normalizeHooks(undefined), []);
  });

  it('wraps a single handler into array', () => {
    const fn: HookHandler = async () => HookResult.continue();
    const result = normalizeHooks(fn);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.handler, fn);
  });

  it('wraps a single Hook object into array', () => {
    const hook: Hook = { handler: async () => HookResult.continue(), name: 'h1' };
    const result = normalizeHooks(hook);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], hook);
  });

  it('normalizes an array of mixed hooks and handlers', () => {
    const fn: HookHandler = async () => HookResult.continue();
    const hook: Hook = { handler: async () => HookResult.continue(), name: 'h2' };
    const result = normalizeHooks([fn, hook]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]?.handler, fn);
    assert.strictEqual(result[1], hook);
  });
});

describe('HookResult', () => {
  it('continue() produces correct result', () => {
    const result: HookResultType = HookResult.continue();
    assert.strictEqual(result.continue, true);
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.modifiedPayload, undefined);
    assert.strictEqual(result.modifiedOutput, undefined);
  });

  it('continueWith() produces result with modified payload', () => {
    const result = HookResult.continueWith({ modifiedPayload: { updated: true } });
    assert.strictEqual(result.continue, true);
    assert.deepStrictEqual(result.modifiedPayload, { updated: true });
    assert.strictEqual(result.modifiedOutput, undefined);
  });

  it('continueWith() produces result with modified output', () => {
    const result = HookResult.continueWith({ modifiedOutput: 'new output' });
    assert.strictEqual(result.continue, true);
    assert.strictEqual(result.modifiedPayload, undefined);
    assert.strictEqual(result.modifiedOutput, 'new output');
  });

  it('continueWith() produces result with both modifications', () => {
    const result = HookResult.continueWith({
      modifiedPayload: { a: 1 },
      modifiedOutput: { b: 2 },
    });
    assert.strictEqual(result.continue, true);
    assert.deepStrictEqual(result.modifiedPayload, { a: 1 });
    assert.deepStrictEqual(result.modifiedOutput, { b: 2 });
  });

  it('fail() produces failure result with error', () => {
    const result = HookResult.fail('something went wrong');
    assert.strictEqual(result.continue, false);
    assert.strictEqual(result.error, 'something went wrong');
  });
});
