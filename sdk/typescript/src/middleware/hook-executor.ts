/**
 * Hook execution engine.
 *
 * Handles sequential execution of hooks with durable step-based execution,
 * payload/output modification, and result aggregation.
 *
 * Matches Python sdk/python/polos/middleware/hook_executor.py.
 */

import type { WorkflowContext } from '../core/context.js';
import type { Hook, HookContext, HookResultType } from './hook.js';
import { normalizeHooks } from './hook.js';

/**
 * Error thrown when a hook fails.
 */
export class HookExecutionError extends Error {
  constructor(
    message: string,
    public readonly hookName: string | undefined,
    public readonly phase: 'onStart' | 'onEnd',
    public override readonly cause?: Error
  ) {
    super(message, { cause });
    this.name = 'HookExecutionError';
  }
}

/**
 * Result from executing a chain of hooks.
 */
export interface HookChainResult<TPayload> {
  /** Whether all hooks passed */
  success: boolean;
  /** Final payload after all modifications */
  payload: TPayload;
  /** Final output after all modifications (for onEnd hooks) */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  output?: unknown | undefined;
  /** Error message if a hook failed */
  error?: string | undefined;
  /** Name of the hook that failed (if any) */
  failedHook?: string | undefined;
  /** Number of hooks executed */
  hooksExecuted: number;
}

/**
 * Options for hook execution.
 */
export interface ExecuteHooksOptions<TPayload> {
  /** The workflow context (must have step for durable execution) */
  ctx: WorkflowContext;
  /** Hook chain name for durable step key naming (e.g., "on_start", "on_end").
   *  Matching Python execute_hooks hook_name parameter. */
  hookName: string;
  /** Payload to pass to hooks */
  payload: TPayload;
  /** Workflow output (for onEnd hooks, matching Python HookContext.current_output) */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- needed for exactOptionalPropertyTypes
  output?: unknown | undefined;
  /** Execution phase */
  phase: 'onStart' | 'onEnd';
}

/**
 * Get a unique identifier for a hook function.
 * Matching Python _get_function_identifier.
 */
function getHookIdentifier(
  hook: { name?: string | undefined; handler: { name: string } },
  index: number
): string {
  if (hook.name) {
    return hook.name;
  }
  if (hook.handler.name && hook.handler.name !== '') {
    return hook.handler.name;
  }
  return `hook_${String(index)}`;
}

/**
 * Execute a chain of hooks sequentially with durable execution.
 *
 * Each hook is executed via ctx.step.run() for durability — results are
 * cached and replayed on retry. Matching Python execute_hooks().
 *
 * Hooks are executed in order. If a hook returns `continue: false`,
 * execution stops and the error is returned. Payload and output
 * modifications from each hook are passed to the next hook.
 */
export async function executeHookChain<TPayload, TState>(
  hooks:
    | Hook<TPayload, TState>
    | Hook<TPayload, TState>[]
    | ((ctx: WorkflowContext<TState>, hookCtx: HookContext<TPayload>) => Promise<HookResultType>)
    | ((ctx: WorkflowContext<TState>, hookCtx: HookContext<TPayload>) => Promise<HookResultType>)[]
    | undefined,
  options: ExecuteHooksOptions<TPayload>
): Promise<HookChainResult<TPayload>> {
  const { ctx, hookName, payload, phase, output } = options;
  const normalizedHooks = normalizeHooks(hooks);

  if (normalizedHooks.length === 0) {
    return {
      success: true,
      payload,
      output,
      hooksExecuted: 0,
    };
  }

  let currentPayload = payload;
  let currentOutput = output;
  let hooksExecuted = 0;

  for (const [index, hook] of normalizedHooks.entries()) {
    const funcId = getHookIdentifier(hook, index);

    const hookCtx: HookContext<TPayload> = {
      workflowId: ctx.workflowId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      currentPayload,
      currentOutput,
      phase,
    };

    try {
      // Execute hook durably via step.run (matching Python: ctx.step.run(...))
      const result = await ctx.step.run<HookResultType>(
        `${hookName}.${funcId}.${String(index)}`,
        () => hook.handler(ctx as WorkflowContext<TState>, hookCtx),
        { input: { payload: currentPayload, output: currentOutput, phase } }
      );
      hooksExecuted++;

      if (!result.continue) {
        return {
          success: false,
          payload: currentPayload,
          output: currentOutput,
          error: result.error ?? 'Hook execution stopped',
          failedHook: hook.name,
          hooksExecuted,
        };
      }

      // Apply payload modifications (matching Python: modified_payload.update(...))
      if (result.modifiedPayload !== undefined) {
        currentPayload = result.modifiedPayload as TPayload;
      }

      // Apply output modifications (matching Python: modified_output.update(...))
      if (result.modifiedOutput !== undefined) {
        currentOutput = result.modifiedOutput;
      }
    } catch (err) {
      hooksExecuted++;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        payload: currentPayload,
        output: currentOutput,
        error: `Hook${hook.name ? ` '${hook.name}'` : ''} threw an error: ${errorMessage}`,
        failedHook: hook.name,
        hooksExecuted,
      };
    }
  }

  return {
    success: true,
    payload: currentPayload,
    output: currentOutput,
    hooksExecuted,
  };
}

/**
 * Execute hooks and throw if any hook fails.
 *
 * Convenience wrapper around `executeHookChain` that throws
 * a `HookExecutionError` if any hook fails.
 *
 * @returns The final payload after all hook modifications
 * @throws HookExecutionError if any hook fails
 */
export async function executeHooksOrThrow<TPayload, TState>(
  hooks:
    | Hook<TPayload, TState>
    | Hook<TPayload, TState>[]
    | ((ctx: WorkflowContext<TState>, hookCtx: HookContext<TPayload>) => Promise<HookResultType>)
    | ((ctx: WorkflowContext<TState>, hookCtx: HookContext<TPayload>) => Promise<HookResultType>)[]
    | undefined,
  options: ExecuteHooksOptions<TPayload>
): Promise<TPayload> {
  const result = await executeHookChain(hooks, options);

  if (!result.success) {
    throw new HookExecutionError(
      result.error ?? 'Hook execution failed',
      result.failedHook,
      options.phase
    );
  }

  return result.payload;
}

/**
 * Create a composite hook from multiple hooks.
 *
 * The composite hook executes all provided hooks in sequence and
 * returns the combined result.
 */
export function composeHooks<TPayload = unknown, TState = unknown>(
  hooks: Hook<TPayload, TState>[]
): Hook<TPayload, TState> {
  return {
    name: `composed(${hooks.map((h) => h.name ?? 'anonymous').join(', ')})`,
    handler: async (ctx, hookCtx) => {
      const result = await executeHookChain(hooks, {
        ctx: ctx as WorkflowContext,
        hookName: 'composed',
        payload: hookCtx.currentPayload,
        phase: hookCtx.phase,
        output: hookCtx.currentOutput,
      });

      if (!result.success) {
        return {
          continue: false,
          error: result.error,
        };
      }

      return {
        continue: true,
        modifiedPayload: result.payload,
        modifiedOutput: result.output,
      };
    },
  };
}

/**
 * Create a hook that only runs if a condition is met.
 */
export function conditionalHook<TPayload = unknown, TState = unknown>(
  condition: (
    ctx: WorkflowContext<TState>,
    hookCtx: HookContext<TPayload>
  ) => boolean | Promise<boolean>,
  hook: Hook<TPayload, TState>
): Hook<TPayload, TState> {
  return {
    name: `conditional(${hook.name ?? 'anonymous'})`,
    handler: async (ctx, hookCtx) => {
      const shouldRun = await condition(ctx, hookCtx);

      if (!shouldRun) {
        return { continue: true };
      }

      return hook.handler(ctx, hookCtx);
    },
  };
}
