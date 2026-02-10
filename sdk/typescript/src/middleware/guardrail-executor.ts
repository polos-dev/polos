/**
 * Guardrail execution engine.
 *
 * Handles sequential execution of guardrails with durable step-based execution,
 * content/tool modification, and result aggregation.
 *
 * Matches Python sdk/python/polos/middleware/guardrail_executor.py.
 */

import type { WorkflowContext } from '../core/context.js';
import type { ToolCall } from '../types/llm.js';
import type { Guardrail, GuardrailContext, GuardrailResultType } from './guardrail.js';
import { normalizeGuardrails } from './guardrail.js';

/**
 * Error thrown when a guardrail fails.
 */
export class GuardrailError extends Error {
  constructor(
    message: string,
    public readonly guardrailName: string | undefined,
    public override readonly cause?: Error
  ) {
    super(message, { cause });
    this.name = 'GuardrailError';
  }
}

/**
 * Result from executing a chain of guardrails.
 */
export interface GuardrailChainResult {
  /** Whether all guardrails passed */
  success: boolean;
  /** Final content after all modifications */
  content?: string | undefined;
  /** Final tool calls after all modifications */
  toolCalls: ToolCall[];
  /** Error message if a guardrail failed */
  error?: string | undefined;
  /** Name of the guardrail that failed (if any) */
  failedGuardrail?: string | undefined;
  /** Number of guardrails executed */
  guardrailsExecuted: number;
}

/**
 * Options for guardrail execution.
 */
export interface ExecuteGuardrailsOptions {
  /** The workflow context (must have step for durable execution) */
  ctx: WorkflowContext;
  /** Guardrail chain name for durable step key naming (e.g., "1.guardrail").
   *  Matching Python execute_guardrails guardrail_name parameter. */
  guardrailName: string;
  /** Text content from LLM */
  content?: string | undefined;
  /** Tool calls from LLM */
  toolCalls: ToolCall[];
}

/**
 * Get a unique identifier for a guardrail.
 * Matching Python _get_guardrail_identifier.
 */
function getGuardrailIdentifier(guardrail: { name?: string | undefined }, index: number): string {
  if (guardrail.name) {
    return guardrail.name;
  }
  return `guardrail_${String(index)}`;
}

/**
 * Execute a chain of guardrails sequentially with durable execution.
 *
 * Each guardrail is executed via ctx.step.run() for durability — results are
 * cached and replayed on retry. Matching Python execute_guardrails().
 *
 * Guardrails are executed in priority order. If a guardrail returns
 * `continue: false`, execution stops and the error is returned.
 * Content and tool call modifications are accumulated sequentially.
 *
 * @example
 * ```typescript
 * const result = await executeGuardrailChain(
 *   [contentFilter, toolValidator],
 *   {
 *     ctx: workflowContext,
 *     guardrailName: '1.guardrail',
 *     content: 'LLM response text',
 *     toolCalls: [],
 *   }
 * );
 *
 * if (!result.success) {
 *   throw new Error(result.error);
 * }
 *
 * // Use the potentially modified content/tools
 * const finalContent = result.content;
 * const finalToolCalls = result.toolCalls;
 * ```
 */
export async function executeGuardrailChain<TState>(
  guardrails:
    | (
        | Guardrail<TState>
        | ((
            ctx: WorkflowContext<TState>,
            guardrailCtx: GuardrailContext
          ) => Promise<GuardrailResultType>)
      )[]
    | undefined,
  options: ExecuteGuardrailsOptions
): Promise<GuardrailChainResult> {
  const { ctx, guardrailName } = options;
  const normalizedGuardrails = normalizeGuardrails(guardrails);

  let content = options.content;
  let toolCalls = [...options.toolCalls];

  if (normalizedGuardrails.length === 0) {
    return {
      success: true,
      content,
      toolCalls,
      guardrailsExecuted: 0,
    };
  }

  let guardrailsExecuted = 0;

  for (const [index, guardrail] of normalizedGuardrails.entries()) {
    const funcId = getGuardrailIdentifier(guardrail, index);

    // Update context with accumulated modifications (matching Python)
    const guardrailCtx: GuardrailContext = {
      content,
      toolCalls,
      messages: [],
      retryCount: 0,
      maxRetries: 0,
    };

    try {
      // Execute guardrail durably via step.run (matching Python: ctx.step.run(...))
      const result = await ctx.step.run<GuardrailResultType>(
        `${guardrailName}.${funcId}.${String(index)}`,
        () => guardrail.handler(ctx as WorkflowContext<TState>, guardrailCtx),
        { input: { content, toolCalls } }
      );
      guardrailsExecuted++;

      if (!result.continue) {
        return {
          success: false,
          content,
          toolCalls,
          error: result.error ?? 'Guardrail validation failed',
          failedGuardrail: guardrail.name,
          guardrailsExecuted,
        };
      }

      // Apply modifications (matching Python)
      if (result.modifiedContent !== undefined) {
        content = result.modifiedContent;
      }
      if (result.modifiedToolCalls !== undefined) {
        toolCalls = result.modifiedToolCalls;
      }
    } catch (err) {
      guardrailsExecuted++;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        content,
        toolCalls,
        error: `Guardrail${guardrail.name ? ` '${guardrail.name}'` : ''} threw an error: ${errorMessage}`,
        failedGuardrail: guardrail.name,
        guardrailsExecuted,
      };
    }
  }

  return {
    success: true,
    content,
    toolCalls,
    guardrailsExecuted,
  };
}

/**
 * Execute guardrails and throw if any guardrail fails.
 *
 * Convenience wrapper around `executeGuardrailChain` that throws
 * a `GuardrailError` if any guardrail fails.
 *
 * @returns The result with final content and tool calls
 * @throws GuardrailError if any guardrail fails
 */
export async function executeGuardrailsOrThrow<TState>(
  guardrails:
    | (
        | Guardrail<TState>
        | ((
            ctx: WorkflowContext<TState>,
            guardrailCtx: GuardrailContext
          ) => Promise<GuardrailResultType>)
      )[]
    | undefined,
  options: ExecuteGuardrailsOptions
): Promise<GuardrailChainResult> {
  const result = await executeGuardrailChain(guardrails, options);

  if (!result.success) {
    throw new GuardrailError(result.error ?? 'Guardrail execution failed', result.failedGuardrail);
  }

  return result;
}

/**
 * Create a composite guardrail from multiple guardrails.
 *
 * The composite guardrail executes all provided guardrails in sequence
 * (by priority) and returns the combined result.
 *
 * @example
 * ```typescript
 * const allGuardrails = composeGuardrails([
 *   contentFilter,
 *   toolValidator,
 *   formatChecker,
 * ]);
 *
 * const agent = defineAgent({
 *   guardrails: [allGuardrails],
 * });
 * ```
 */
export function composeGuardrails<TState = unknown>(
  guardrails: Guardrail<TState>[]
): Guardrail<TState> {
  return {
    name: `composed(${guardrails.map((g) => g.name ?? 'anonymous').join(', ')})`,
    handler: async (ctx, guardrailCtx) => {
      const result = await executeGuardrailChain(guardrails, {
        ctx: ctx as WorkflowContext,
        guardrailName: 'composed',
        content: guardrailCtx.content,
        toolCalls: guardrailCtx.toolCalls,
      });

      if (!result.success) {
        return {
          continue: false,
          error: result.error,
        };
      }

      return {
        continue: true,
        modifiedContent: result.content,
        modifiedToolCalls: result.toolCalls,
      };
    },
  };
}
