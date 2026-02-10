import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  jsonReplacer,
  jsonReviver,
  serialize,
  deserialize,
  deepClone,
  isSerializable,
} from './serializer.js';

describe('jsonReplacer', () => {
  it('converts Date to tagged object', () => {
    const date = new Date('2024-01-15T12:00:00.000Z');
    const result = jsonReplacer('', date);
    assert.deepStrictEqual(result, { __type: 'Date', value: '2024-01-15T12:00:00.000Z' });
  });

  it('converts BigInt to tagged object', () => {
    const result = jsonReplacer('', BigInt('12345678901234567890'));
    assert.deepStrictEqual(result, { __type: 'BigInt', value: '12345678901234567890' });
  });

  it('converts Map to tagged object', () => {
    const map = new Map<string, number>([
      ['a', 1],
      ['b', 2],
    ]);
    const result = jsonReplacer('', map);
    assert.deepStrictEqual(result, {
      __type: 'Map',
      value: [
        ['a', 1],
        ['b', 2],
      ],
    });
  });

  it('converts Set to tagged object', () => {
    const set = new Set([1, 2, 3]);
    const result = jsonReplacer('', set);
    assert.deepStrictEqual(result, { __type: 'Set', value: [1, 2, 3] });
  });

  it('passes through plain values unchanged', () => {
    assert.strictEqual(jsonReplacer('', 42), 42);
    assert.strictEqual(jsonReplacer('', 'hello'), 'hello');
    assert.strictEqual(jsonReplacer('', null), null);
    assert.strictEqual(jsonReplacer('', true), true);
  });
});

describe('jsonReviver', () => {
  it('restores Date from tagged object', () => {
    const result = jsonReviver('', { __type: 'Date', value: '2024-01-15T12:00:00.000Z' });
    assert.ok(result instanceof Date);
    assert.strictEqual((result as Date).toISOString(), '2024-01-15T12:00:00.000Z');
  });

  it('restores BigInt from tagged object', () => {
    const result = jsonReviver('', { __type: 'BigInt', value: '12345678901234567890' });
    assert.strictEqual(result, BigInt('12345678901234567890'));
  });

  it('restores Map from tagged object', () => {
    const result = jsonReviver('', {
      __type: 'Map',
      value: [
        ['a', 1],
        ['b', 2],
      ],
    });
    assert.ok(result instanceof Map);
    assert.strictEqual((result as Map<string, number>).get('a'), 1);
    assert.strictEqual((result as Map<string, number>).get('b'), 2);
  });

  it('restores Set from tagged object', () => {
    const result = jsonReviver('', { __type: 'Set', value: [1, 2, 3] });
    assert.ok(result instanceof Set);
    assert.strictEqual((result as Set<number>).size, 3);
    assert.ok((result as Set<number>).has(2));
  });

  it('passes through unknown tagged objects', () => {
    const input = { __type: 'Unknown', value: 'test' };
    const result = jsonReviver('', input);
    assert.deepStrictEqual(result, input);
  });

  it('passes through plain values unchanged', () => {
    assert.strictEqual(jsonReviver('', 42), 42);
    assert.strictEqual(jsonReviver('', 'hello'), 'hello');
  });
});

describe('serialize / deserialize round-trip', () => {
  // Note: JSON.stringify calls Date.toJSON() before passing to the replacer,
  // so nested Dates become ISO strings. The replacer handles Date only when
  // it is the top-level value. BigInt, Map, Set don't have .toJSON() so they
  // are handled correctly by the replacer at any nesting level.

  it('round-trips Date as ISO string (JSON.stringify calls toJSON before replacer)', () => {
    const original = { created: new Date('2024-06-01T00:00:00.000Z') };
    const json = serialize(original);
    const restored = deserialize<{ created: string }>(json);
    // Date becomes ISO string due to JSON.stringify behavior
    assert.strictEqual(restored.created, '2024-06-01T00:00:00.000Z');
  });

  it('round-trips BigInt', () => {
    const original = { big: BigInt('99999999999999999999') };
    const json = serialize(original);
    const restored = deserialize<{ big: bigint }>(json);
    assert.strictEqual(restored.big, BigInt('99999999999999999999'));
  });

  it('round-trips Map', () => {
    const original = {
      lookup: new Map([
        ['x', 10],
        ['y', 20],
      ]),
    };
    const json = serialize(original);
    const restored = deserialize<{ lookup: Map<string, number> }>(json);
    assert.ok(restored.lookup instanceof Map);
    assert.strictEqual(restored.lookup.get('x'), 10);
  });

  it('round-trips Set', () => {
    const original = { ids: new Set(['a', 'b', 'c']) };
    const json = serialize(original);
    const restored = deserialize<{ ids: Set<string> }>(json);
    assert.ok(restored.ids instanceof Set);
    assert.strictEqual(restored.ids.size, 3);
  });

  it('round-trips nested objects with mixed types', () => {
    const original = {
      name: 'test',
      count: 42,
      tags: new Set(['a', 'b']),
      metadata: new Map<string, unknown>([['key', 'value']]),
    };
    const restored = deserialize<typeof original>(serialize(original));
    assert.strictEqual(restored.name, 'test');
    assert.strictEqual(restored.count, 42);
    assert.ok(restored.tags instanceof Set);
    assert.ok(restored.metadata instanceof Map);
  });
});

describe('deepClone', () => {
  it('creates an independent copy', () => {
    const original = { a: 1, nested: { b: 2 } };
    const cloned = deepClone(original);
    assert.deepStrictEqual(cloned, original);
    cloned.nested.b = 99;
    assert.strictEqual(original.nested.b, 2);
  });

  it('preserves Map and Set types', () => {
    const original = { s: new Set([1, 2]), m: new Map([['a', 1]]) };
    const cloned = deepClone(original);
    assert.ok(cloned.s instanceof Set);
    assert.ok(cloned.m instanceof Map);
    assert.strictEqual(cloned.s.size, 2);
    assert.strictEqual(cloned.m.get('a'), 1);
  });
});

describe('isSerializable', () => {
  it('returns true for plain objects', () => {
    assert.strictEqual(isSerializable({ a: 1, b: 'hello' }), true);
  });

  it('returns true for special types (Date, BigInt, Map, Set)', () => {
    assert.strictEqual(isSerializable(new Date()), true);
    assert.strictEqual(isSerializable(new Map()), true);
    assert.strictEqual(isSerializable(new Set()), true);
    assert.strictEqual(isSerializable(BigInt(42)), true);
  });

  it('returns false for circular references', () => {
    const obj: Record<string, unknown> = {};
    obj['self'] = obj;
    assert.strictEqual(isSerializable(obj), false);
  });
});
