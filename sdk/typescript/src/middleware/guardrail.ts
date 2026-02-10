/**
 * Guardrails for validating and transforming LLM outputs.
 *
 * Guardrails are executed after each LLM generation to validate
 * the output and optionally modify it before continuing.
 */

import type { WorkflowContext } from '../core/context.js';
import type { CoreMessage, ToolCall } from '../types/llm.js';

/**
 * Context passed to guardrails during execution.
 */
export interface GuardrailContext {
  /** Text content from LLM (if any) */
  content?: string | undefined;
  /** Tool calls from LLM (if any) */
  toolCalls: ToolCall[];
  /** Messages so far in the conversation */
  messages: CoreMessage[];
  /** Number of guardrail retries so far */
  retryCount: number;
  /** Maximum allowed retries */
  maxRetries: number;
}

/**
 * Result from a guardrail execution.
 */
export interface GuardrailResultType {
  /** Whether to continue execution */
  continue: boolean;
  /** Error message if guardrail failed */
  error?: string | undefined;
  /** Modified content to use instead */
  modifiedContent?: string | undefined;
  /** Modified tool calls to use instead */
  modifiedToolCalls?: ToolCall[] | undefined;
  /** Whether to retry the LLM call */
  retry?: boolean | undefined;
  /** Custom feedback to include in retry prompt */
  retryFeedback?: string | undefined;
}

/**
 * Guardrail handler function type.
 */
export type GuardrailHandler<TState = unknown> = (
  ctx: WorkflowContext<TState>,
  guardrailCtx: GuardrailContext
) => Promise<GuardrailResultType>;

/**
 * Guardrail definition with optional metadata.
 */
export interface Guardrail<TState = unknown> {
  /** Guardrail handler function */
  handler: GuardrailHandler<TState>;
  /** Optional guardrail name for debugging/tracing */
  name?: string | undefined;
  /** Optional guardrail description */
  description?: string | undefined;
  /** Priority (lower numbers run first, default: 0) */
  priority?: number | undefined;
}

/**
 * Options for defining a guardrail.
 */
export interface DefineGuardrailOptions {
  /** Guardrail name for debugging/tracing */
  name?: string | undefined;
  /** Guardrail description */
  description?: string | undefined;
  /** Priority (lower numbers run first, default: 0) */
  priority?: number | undefined;
}

/**
 * Helper for creating guardrail results.
 */
export const GuardrailResult = {
  /**
   * Continue execution without modifications.
   *
   * @example
   * ```typescript
   * if (isContentSafe(guardrailCtx.content)) {
   *   return GuardrailResult.continue();
   * }
   * ```
   */
  continue: (): GuardrailResultType => ({ continue: true }),

  /**
   * Continue execution with modifications.
   *
   * @example
   * ```typescript
   * const sanitized = sanitizeContent(guardrailCtx.content);
   * return GuardrailResult.continueWith({
   *   modifiedContent: sanitized,
   * });
   * ```
   */
  continueWith: (options: {
    modifiedContent?: string;
    modifiedToolCalls?: ToolCall[];
  }): GuardrailResultType => {
    const result: GuardrailResultType = { continue: true };
    if (options.modifiedContent !== undefined) {
      result.modifiedContent = options.modifiedContent;
    }
    if (options.modifiedToolCalls !== undefined) {
      result.modifiedToolCalls = options.modifiedToolCalls;
    }
    return result;
  },

  /**
   * Stop execution with an error.
   *
   * @example
   * ```typescript
   * if (containsHarmfulContent(guardrailCtx.content)) {
   *   return GuardrailResult.fail('Content contains harmful material');
   * }
   * ```
   */
  fail: (error: string): GuardrailResultType => ({
    continue: false,
    error,
  }),

  /**
   * Retry the LLM call with optional feedback.
   *
   * This will trigger a new LLM generation with the provided feedback
   * included in the context. The retry count will be incremented.
   *
   * @example
   * ```typescript
   * if (!isValidFormat(guardrailCtx.content)) {
   *   return GuardrailResult.retry(
   *     'Please format your response as valid JSON with the required fields.'
   *   );
   * }
   * ```
   */
  retry: (feedback?: string): GuardrailResultType => ({
    continue: false,
    retry: true,
    retryFeedback: feedback,
  }),
};

/**
 * Define a guardrail for validating LLM outputs.
 *
 * @example
 * ```typescript
 * // Content filter guardrail
 * const contentFilter = defineGuardrail(
 *   async (ctx, guardrailCtx) => {
 *     const content = guardrailCtx.content;
 *
 *     if (!content) {
 *       return GuardrailResult.fail('No content generated');
 *     }
 *
 *     if (containsInappropriateContent(content)) {
 *       return GuardrailResult.fail('Content contains inappropriate material');
 *     }
 *
 *     const sanitized = sanitizeContent(content);
 *     return GuardrailResult.continueWith({ modifiedContent: sanitized });
 *   },
 *   { name: 'content-filter', priority: 10 }
 * );
 *
 * // Tool validator guardrail
 * const toolValidator = defineGuardrail(async (ctx, guardrailCtx) => {
 *   for (const call of guardrailCtx.toolCalls) {
 *     if (call.name === 'dangerous-tool' && !ctx.state.isAdmin) {
 *       return GuardrailResult.fail('Unauthorized tool access');
 *     }
 *   }
 *   return GuardrailResult.continue();
 * });
 * ```
 */
export function defineGuardrail<TState = unknown>(
  handler: GuardrailHandler<TState>,
  options?: DefineGuardrailOptions
): Guardrail<TState> {
  return {
    handler,
    name: options?.name,
    description: options?.description,
    priority: options?.priority ?? 0,
  };
}

/**
 * Type guard to check if a value is a Guardrail object.
 */
export function isGuardrail<TState = unknown>(value: unknown): value is Guardrail<TState> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'handler' in value &&
    typeof (value as Guardrail).handler === 'function'
  );
}

/**
 * Normalize a guardrail handler or Guardrail object to a Guardrail.
 */
export function normalizeGuardrail<TState = unknown>(
  guardrailOrHandler: Guardrail<TState> | GuardrailHandler<TState>
): Guardrail<TState> {
  if (isGuardrail<TState>(guardrailOrHandler)) {
    return guardrailOrHandler;
  }
  return { handler: guardrailOrHandler };
}

/**
 * Normalize and sort an array of guardrails by priority.
 */
export function normalizeGuardrails<TState = unknown>(
  guardrails: (Guardrail<TState> | GuardrailHandler<TState>)[] | undefined
): Guardrail<TState>[] {
  if (guardrails === undefined) {
    return [];
  }

  return guardrails
    .map((g) => normalizeGuardrail(g))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}
