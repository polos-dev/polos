/**
 * State management for workflows.
 *
 * Handles state initialization, validation, and serialization using Zod schemas.
 */

import type { ZodType } from 'zod';
import { serialize, deserialize } from '../utils/serializer.js';

/**
 * Maximum state size in bytes (1MB).
 */
export const MAX_STATE_SIZE = 1024 * 1024;

/**
 * Error thrown when state validation fails.
 */
export class StateValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: unknown[]
  ) {
    const issueDetails = issues
      .map((issue) => {
        if (issue && typeof issue === 'object') {
          const i = issue as Record<string, unknown>;
          const path = Array.isArray(i['path']) ? (i['path'] as unknown[]).join('.') : '';
          const msg = typeof i['message'] === 'string' ? i['message'] : '';
          return path ? `${path}: ${msg}` : msg;
        }
        return String(issue);
      })
      .join('; ');
    super(issueDetails ? `${message}: ${issueDetails}` : message);
    this.name = 'StateValidationError';
  }
}

/**
 * Error thrown when state exceeds size limit.
 */
export class StateSizeError extends Error {
  constructor(
    public readonly size: number,
    public readonly maxSize: number
  ) {
    super(`State size (${String(size)} bytes) exceeds maximum allowed (${String(maxSize)} bytes)`);
    this.name = 'StateSizeError';
  }
}

/**
 * Initialize state from a Zod schema.
 * Uses schema defaults to create the initial state.
 */
export function initializeState<TState>(schema: ZodType<TState>): TState {
  // Parse an empty object to get defaults
  const result = schema.safeParse({});

  if (!result.success) {
    // If parsing fails, try with undefined to trigger defaults
    const retryResult = schema.safeParse(undefined);
    if (!retryResult.success) {
      throw new StateValidationError(
        'Failed to initialize state from schema defaults',
        retryResult.error.issues
      );
    }
    return retryResult.data;
  }

  return result.data;
}

/**
 * Validate state against a Zod schema.
 */
export function validateState<TState>(state: unknown, schema: ZodType<TState>): TState {
  const result = schema.safeParse(state);

  if (!result.success) {
    throw new StateValidationError('State validation failed', result.error.issues);
  }

  return result.data;
}

/**
 * Serialize state for persistence.
 * Validates size limit before returning.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- TState constraint is useful for callers
export function serializeState<TState>(state: TState): string {
  const serialized = serialize(state);
  const size = new TextEncoder().encode(serialized).length;

  if (size > MAX_STATE_SIZE) {
    throw new StateSizeError(size, MAX_STATE_SIZE);
  }

  return serialized;
}

/**
 * Deserialize state from storage.
 */
export function deserializeState<TState>(serialized: string, schema?: ZodType<TState>): TState {
  const state = deserialize<TState>(serialized);

  if (schema) {
    return validateState(state, schema);
  }

  return state;
}

/**
 * Merge partial state updates into existing state.
 */
export function mergeState<TState extends object>(
  currentState: TState,
  updates: Partial<TState>
): TState {
  return {
    ...currentState,
    ...updates,
  };
}

/**
 * Create a deep clone of state.
 */
export function cloneState<TState>(state: TState): TState {
  return deserialize(serialize(state));
}
