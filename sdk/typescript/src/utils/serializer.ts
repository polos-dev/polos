/**
 * JSON serialization utilities with support for special types.
 */

/**
 * Custom replacer for JSON.stringify that handles:
 * - Date objects -> ISO strings
 * - BigInt -> string with 'n' suffix
 * - undefined -> null (when in arrays)
 * - Map -> object with __type marker
 * - Set -> array with __type marker
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return { __type: 'Date', value: value.toISOString() };
  }
  if (typeof value === 'bigint') {
    return { __type: 'BigInt', value: value.toString() };
  }
  if (value instanceof Map) {
    return { __type: 'Map', value: Array.from(value.entries()) };
  }
  if (value instanceof Set) {
    return { __type: 'Set', value: Array.from(value) };
  }
  return value;
}

/**
 * Custom reviver for JSON.parse that restores:
 * - Date objects from ISO strings
 * - BigInt from string
 * - Map from entries
 * - Set from array
 */
export function jsonReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && '__type' in value) {
    const typed = value as { __type: string; value: unknown };
    switch (typed.__type) {
      case 'Date':
        return new Date(typed.value as string);
      case 'BigInt':
        return BigInt(typed.value as string);
      case 'Map':
        return new Map(typed.value as [unknown, unknown][]);
      case 'Set':
        return new Set(typed.value as unknown[]);
    }
  }
  return value;
}

/**
 * Serialize a value to JSON string with support for special types.
 */
export function serialize(value: unknown): string {
  return JSON.stringify(value, jsonReplacer);
}

/**
 * Deserialize a JSON string with support for special types.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is used for return type inference by callers
export function deserialize<T = unknown>(json: string): T {
  return JSON.parse(json, jsonReviver) as T;
}

/**
 * Deep clone a value using JSON serialization.
 * Handles special types like Date, BigInt, Map, Set.
 */
export function deepClone<T>(value: T): T {
  return deserialize(serialize(value));
}

/**
 * Check if a value is JSON-serializable.
 */
export function isSerializable(value: unknown): boolean {
  try {
    serialize(value);
    return true;
  } catch {
    return false;
  }
}
