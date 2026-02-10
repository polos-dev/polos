/**
 * Stop conditions for agents.
 *
 * Stop conditions allow you to define when an agent should stop executing.
 * Stop conditions execute durably within workflow context using step.run().
 *
 * Matches Python sdk/python/polos/agents/stop_conditions.py.
 */

import type { LLMToolCall, LLMUsage } from '../llm/types.js';

// ── Types ────────────────────────────────────────────────────────────

/**
 * Information about a tool result within a step.
 * Matches Python ToolResult Pydantic model.
 */
export interface ToolResultInfo {
  tool_name?: string | undefined;
  status?: string | undefined;
  result?: unknown;
  result_schema?: string | undefined;
  tool_call_id?: string | undefined;
  tool_call_call_id?: string | undefined;
}

/**
 * A single step in agent execution.
 * Matches Python Step Pydantic model.
 */
export interface StepInfo {
  step: number;
  content: string | null;
  tool_calls: LLMToolCall[];
  tool_results: ToolResultInfo[];
  usage: LLMUsage | null;
  raw_output: unknown;
}

/**
 * Context available to stop conditions.
 * Matches Python StopConditionContext Pydantic model.
 */
export interface StopConditionContext {
  steps: StepInfo[];
  agent_id?: string | undefined;
  agent_run_id?: string | undefined;
}

/**
 * A stop condition function that receives context and returns whether to stop.
 */
export interface StopCondition {
  (ctx: StopConditionContext): boolean | Promise<boolean>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- metadata for identification
  __stop_condition_fn__?: Function | undefined;
  __stop_condition_name__?: string | undefined;
}

// ── stopCondition decorator ──────────────────────────────────────────

/**
 * Decorator for stop condition functions.
 *
 * Stop conditions take `ctx: StopConditionContext` as the first parameter
 * and optionally a config object as the second parameter.
 * They return a boolean (true to stop, false to continue).
 *
 * When the decorated function has a config parameter, calling it with config
 * returns a configured callable that captures the config.
 *
 * Matches Python @stop_condition decorator.
 *
 * @example
 * ```typescript
 * // Simple stop condition (no config)
 * const alwaysStop = stopCondition(
 *   (ctx: StopConditionContext) => true
 * );
 *
 * // With config
 * const maxTokens = stopCondition(
 *   (ctx: StopConditionContext, config: { limit: number }) => {
 *     const total = ctx.steps.reduce((sum, s) => sum + (s.usage?.total_tokens ?? 0), 0);
 *     return total >= config.limit;
 *   }
 * );
 * // Use: maxTokens({ limit: 1000 })
 * ```
 */
/**
 * A stop condition factory — produces StopCondition callables when given config.
 */
export interface StopConditionFactory<TConfig> {
  (config: TConfig): StopCondition;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- metadata for identification
  __stop_condition_fn__: Function;
  __stop_condition_name__: string;
}

export function stopCondition<TConfig>(
  fn: (ctx: StopConditionContext, config: TConfig) => boolean | Promise<boolean>
): StopConditionFactory<TConfig>;
export function stopCondition(
  fn: (ctx: StopConditionContext) => boolean | Promise<boolean>
): StopCondition;
export function stopCondition<TConfig = void>(
  fn: (ctx: StopConditionContext, config?: TConfig) => boolean | Promise<boolean>
): StopCondition | StopConditionFactory<TConfig> {
  // Check function arity to determine if config is needed
  const hasConfig = fn.length >= 2;

  if (hasConfig) {
    // Returns a factory that takes config and returns a configured StopCondition
    const factory: StopConditionFactory<TConfig> = Object.assign(
      (config: TConfig): StopCondition => {
        const configuredFn = Object.assign(
          (ctx: StopConditionContext): boolean | Promise<boolean> => fn(ctx, config),
          {
            __stop_condition_fn__: fn as Function, // eslint-disable-line @typescript-eslint/no-unsafe-function-type
            __stop_condition_name__: fn.name || 'anonymous',
          }
        );
        return configuredFn;
      },
      {
        __stop_condition_fn__: fn as Function, // eslint-disable-line @typescript-eslint/no-unsafe-function-type
        __stop_condition_name__: fn.name || 'anonymous',
      }
    );
    return factory;
  }

  // No config — the function itself is the stop condition
  const wrapper: StopCondition = Object.assign(
    (ctx: StopConditionContext): boolean | Promise<boolean> => fn(ctx),
    {
      __stop_condition_fn__: fn as Function, // eslint-disable-line @typescript-eslint/no-unsafe-function-type
      __stop_condition_name__: fn.name || 'anonymous',
    }
  );
  return wrapper;
}

// ── Built-in stop conditions ─────────────────────────────────────────

/**
 * Stop when total tokens exceed limit.
 * Matches Python max_tokens stop condition.
 *
 * @example
 * ```typescript
 * defineAgent({
 *   stopConditions: [maxTokens({ limit: 1000 })],
 * });
 * ```
 */
export const maxTokens = stopCondition(function maxTokens(
  ctx: StopConditionContext,
  config: { limit: number }
): boolean {
  let total = 0;
  for (const step of ctx.steps) {
    if (step.usage) {
      total += step.usage.total_tokens;
    }
  }
  return total >= config.limit;
});

/**
 * Stop when number of steps reaches count.
 * Matches Python max_steps stop condition.
 *
 * @example
 * ```typescript
 * defineAgent({
 *   stopConditions: [maxSteps({ count: 10 })],
 * });
 * // Or with default count of 5:
 * defineAgent({
 *   stopConditions: [maxSteps({ count: 5 })],
 * });
 * ```
 */
export const maxSteps = stopCondition(function maxSteps(
  ctx: StopConditionContext,
  config: { count: number }
): boolean {
  return ctx.steps.length >= config.count;
});

/**
 * Stop when all specified tools have been executed.
 * Matches Python executed_tool stop condition.
 *
 * @example
 * ```typescript
 * defineAgent({
 *   stopConditions: [executedTool({ toolNames: ['get_weather', 'search'] })],
 * });
 * ```
 */
export const executedTool = stopCondition(function executedTool(
  ctx: StopConditionContext,
  config: { toolNames: string[] }
): boolean {
  const required = new Set(config.toolNames);
  if (required.size === 0) return false;

  const executed = new Set<string>();
  for (const step of ctx.steps) {
    for (const toolCall of step.tool_calls) {
      executed.add(toolCall.function.name);
    }
  }

  for (const name of required) {
    if (!executed.has(name)) return false;
  }
  return true;
});

/**
 * Stop when all specified texts are found in response content.
 * Matches Python has_text stop condition.
 *
 * @example
 * ```typescript
 * defineAgent({
 *   stopConditions: [hasText({ texts: ['done', 'complete'] })],
 * });
 * ```
 */
export const hasText = stopCondition(function hasText(
  ctx: StopConditionContext,
  config: { texts: string[] }
): boolean {
  if (config.texts.length === 0) return false;

  const combined: string[] = [];
  for (const step of ctx.steps) {
    if (step.content) {
      combined.push(step.content);
    }
  }
  const fullText = combined.join(' ');

  return config.texts.every((t) => fullText.includes(t));
});
