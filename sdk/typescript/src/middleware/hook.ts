/**
 * Lifecycle hooks for workflow and agent execution.
 *
 * Hooks allow intercepting and modifying workflow execution at key points.
 */

import type { WorkflowContext } from '../core/context.js';

/**
 * Context passed to hooks during execution.
 */
export interface HookContext<TPayload = unknown> {
  /** Workflow ID (matching Python HookContext.workflow_id) */
  workflowId: string;
  /** Session ID (matching Python HookContext.session_id) */
  sessionId?: string | undefined;
  /** User ID (matching Python HookContext.user_id) */
  userId?: string | undefined;
  /** Current payload (may be modified by previous hooks) */
  currentPayload: TPayload;
  /** Current output (may be modified by previous hooks, only in onEnd) */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  currentOutput?: unknown | undefined;
  /** Hook execution phase */
  phase: 'onStart' | 'onEnd';
}

/**
 * Result from a hook execution.
 */
export interface HookResultType {
  /** Whether to continue execution */
  continue: boolean;
  /** Error message if hook failed (matching Python HookResult.error_message) */
  error?: string | undefined;
  /** Modified payload (matching Python HookResult.modified_payload) */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  modifiedPayload?: unknown | undefined;
  /** Modified output (matching Python HookResult.modified_output, only in onEnd) */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  modifiedOutput?: unknown | undefined;
}

/**
 * Hook function type for workflow lifecycle events.
 */
export type HookHandler<TPayload = unknown, TState = unknown> = (
  ctx: WorkflowContext<TState>,
  hookCtx: HookContext<TPayload>
) => Promise<HookResultType>;

/**
 * Hook definition with optional metadata.
 */
export interface Hook<TPayload = unknown, TState = unknown> {
  /** Hook handler function */
  handler: HookHandler<TPayload, TState>;
  /** Optional hook name for debugging/tracing */
  name?: string | undefined;
  /** Optional hook description */
  description?: string | undefined;
}

/**
 * Options for defining a hook.
 */
export interface DefineHookOptions {
  /** Hook name for debugging/tracing */
  name?: string | undefined;
  /** Hook description */
  description?: string | undefined;
}

/**
 * Helper for creating hook results.
 */
export const HookResult = {
  /** Continue execution without modifications */
  continue: (): HookResultType => ({ continue: true }),

  /**
   * Continue execution with modifications.
   *
   * @example
   * ```typescript
   * return HookResult.continueWith({
   *   modifiedPayload: {
   *     ...hookCtx.currentPayload,
   *     timestamp: Date.now(),
   *   },
   * });
   * ```
   */
  continueWith: (options: {
    modifiedPayload?: unknown;
    modifiedOutput?: unknown;
  }): HookResultType => {
    const result: HookResultType = { continue: true };
    if (options.modifiedPayload !== undefined) {
      result.modifiedPayload = options.modifiedPayload;
    }
    if (options.modifiedOutput !== undefined) {
      result.modifiedOutput = options.modifiedOutput;
    }
    return result;
  },

  /**
   * Stop execution with an error.
   *
   * @example
   * ```typescript
   * if (!hookCtx.currentPayload.userId) {
   *   return HookResult.fail('userId is required');
   * }
   * ```
   */
  fail: (error: string): HookResultType => ({
    continue: false,
    error,
  }),
};

/**
 * Define a hook for workflow lifecycle events.
 *
 * @example
 * ```typescript
 * const loggingHook = defineHook(async (ctx, hookCtx) => {
 *   console.log(`Starting workflow: ${ctx.workflowId}`);
 *   console.log(`Payload: ${JSON.stringify(hookCtx.currentPayload)}`);
 *   return HookResult.continue();
 * });
 *
 * const validationHook = defineHook(
 *   async (ctx, hookCtx) => {
 *     if (!hookCtx.currentPayload.userId) {
 *       return HookResult.fail('userId is required');
 *     }
 *     return HookResult.continue();
 *   },
 *   { name: 'validation-hook', description: 'Validates required fields' }
 * );
 * ```
 */
export function defineHook<TPayload = unknown, TState = unknown>(
  handler: HookHandler<TPayload, TState>,
  options?: DefineHookOptions
): Hook<TPayload, TState> {
  return {
    handler,
    name: options?.name,
    description: options?.description,
  };
}

/**
 * Type guard to check if a value is a Hook object.
 */
export function isHook<TPayload = unknown, TState = unknown>(
  value: unknown
): value is Hook<TPayload, TState> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'handler' in value &&
    typeof (value as Hook).handler === 'function'
  );
}

/**
 * Normalize a hook handler or Hook object to a Hook.
 */
export function normalizeHook<TPayload = unknown, TState = unknown>(
  hookOrHandler: Hook<TPayload, TState> | HookHandler<TPayload, TState>
): Hook<TPayload, TState> {
  if (isHook<TPayload, TState>(hookOrHandler)) {
    return hookOrHandler;
  }
  return { handler: hookOrHandler };
}

/**
 * Normalize an array of hooks or handlers.
 */
export function normalizeHooks<TPayload = unknown, TState = unknown>(
  hooks:
    | Hook<TPayload, TState>
    | HookHandler<TPayload, TState>
    | (Hook<TPayload, TState> | HookHandler<TPayload, TState>)[]
    | undefined
): Hook<TPayload, TState>[] {
  if (hooks === undefined) {
    return [];
  }

  if (Array.isArray(hooks)) {
    return hooks.map((h) => normalizeHook(h));
  }

  return [normalizeHook(hooks)];
}
