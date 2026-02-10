import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  initializeState,
  validateState,
  serializeState,
  deserializeState,
  mergeState,
  cloneState,
  MAX_STATE_SIZE,
  StateValidationError,
  StateSizeError,
} from './state.js';

describe('initializeState', () => {
  it('creates state from schema defaults', () => {
    const schema = z.object({
      count: z.number().default(0),
      name: z.string().default('default'),
    });
    const state = initializeState(schema);
    assert.deepStrictEqual(state, { count: 0, name: 'default' });
  });

  it('throws StateValidationError when schema has required fields without defaults', () => {
    const schema = z.object({
      required: z.string(),
    });
    assert.throws(
      () => initializeState(schema),
      (err: unknown) => err instanceof StateValidationError
    );
  });
});

describe('validateState', () => {
  it('returns validated state when valid', () => {
    const schema = z.object({ count: z.number() });
    const result = validateState({ count: 42 }, schema);
    assert.deepStrictEqual(result, { count: 42 });
  });

  it('throws StateValidationError for invalid state', () => {
    const schema = z.object({ count: z.number() });
    assert.throws(
      () => validateState({ count: 'not a number' }, schema),
      (err: any) => {
        assert.ok(err instanceof StateValidationError);
        assert.ok(err.issues.length > 0);
        return true;
      }
    );
  });

  it('strips extra properties with strict schema', () => {
    const schema = z.object({ a: z.number() }).strict();
    assert.throws(
      () => validateState({ a: 1, b: 2 }, schema),
      (err: unknown) => err instanceof StateValidationError
    );
  });
});

describe('serializeState', () => {
  it('serializes state to JSON string', () => {
    const state = { count: 1, name: 'test' };
    const json = serializeState(state);
    assert.strictEqual(typeof json, 'string');
    assert.deepStrictEqual(JSON.parse(json), state);
  });

  it('throws StateSizeError when state exceeds MAX_STATE_SIZE', () => {
    const largeState = { data: 'x'.repeat(MAX_STATE_SIZE + 1) };
    assert.throws(
      () => serializeState(largeState),
      (err: any) => {
        assert.ok(err instanceof StateSizeError);
        assert.ok(err.size > MAX_STATE_SIZE);
        assert.strictEqual(err.maxSize, MAX_STATE_SIZE);
        return true;
      }
    );
  });
});

describe('deserializeState', () => {
  it('deserializes JSON string to state', () => {
    const original = { count: 1, items: [1, 2, 3] };
    const json = serializeState(original);
    const restored = deserializeState<typeof original>(json);
    assert.deepStrictEqual(restored, original);
  });

  it('validates with schema when provided', () => {
    const schema = z.object({ count: z.number() });
    const json = '{"count":42}';
    const result = deserializeState(json, schema);
    assert.deepStrictEqual(result, { count: 42 });
  });

  it('throws when deserialized state fails schema validation', () => {
    const schema = z.object({ count: z.number() });
    const json = '{"count":"not a number"}';
    assert.throws(
      () => deserializeState(json, schema),
      (err: unknown) => err instanceof StateValidationError
    );
  });
});

describe('mergeState', () => {
  it('merges partial updates into existing state', () => {
    const current = { a: 1, b: 2, c: 3 };
    const result = mergeState(current, { b: 20 });
    assert.deepStrictEqual(result, { a: 1, b: 20, c: 3 });
  });

  it('does not mutate the original state', () => {
    const current = { a: 1, b: 2 };
    const result = mergeState(current, { a: 10 });
    assert.strictEqual(current.a, 1);
    assert.strictEqual(result.a, 10);
  });
});

describe('cloneState', () => {
  it('creates a deep independent copy', () => {
    const original = { a: 1, nested: { b: 2 } };
    const cloned = cloneState(original);
    assert.deepStrictEqual(cloned, original);
    cloned.nested.b = 99;
    assert.strictEqual(original.nested.b, 2);
  });
});
