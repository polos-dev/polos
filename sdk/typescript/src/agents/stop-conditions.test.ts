import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  stopCondition,
  maxSteps,
  maxTokens,
  executedTool,
  hasText,
  type StopConditionContext,
  type StepInfo,
} from './stop-conditions.js';

function makeStep(overrides?: Partial<StepInfo>): StepInfo {
  return {
    step: 0,
    content: null,
    tool_calls: [],
    tool_results: [],
    usage: null,
    raw_output: null,
    ...overrides,
  };
}

function makeContext(steps: StepInfo[]): StopConditionContext {
  return { steps };
}

describe('maxSteps', () => {
  it('returns false when step count is below limit', () => {
    const condition = maxSteps({ count: 3 });
    const ctx = makeContext([makeStep(), makeStep()]);
    assert.strictEqual(condition(ctx), false);
  });

  it('returns true when step count reaches limit', () => {
    const condition = maxSteps({ count: 3 });
    const ctx = makeContext([makeStep(), makeStep(), makeStep()]);
    assert.strictEqual(condition(ctx), true);
  });

  it('returns true when step count exceeds limit', () => {
    const condition = maxSteps({ count: 2 });
    const ctx = makeContext([makeStep(), makeStep(), makeStep()]);
    assert.strictEqual(condition(ctx), true);
  });
});

describe('maxTokens', () => {
  it('returns false when total tokens are below limit', () => {
    const condition = maxTokens({ limit: 100 });
    const ctx = makeContext([
      makeStep({ usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }),
      makeStep({ usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }),
    ]);
    assert.strictEqual(condition(ctx), false);
  });

  it('returns true when total tokens reach limit', () => {
    const condition = maxTokens({ limit: 100 });
    const ctx = makeContext([
      makeStep({ usage: { input_tokens: 25, output_tokens: 25, total_tokens: 50 } }),
      makeStep({ usage: { input_tokens: 25, output_tokens: 25, total_tokens: 50 } }),
    ]);
    assert.strictEqual(condition(ctx), true);
  });

  it('ignores steps with null usage', () => {
    const condition = maxTokens({ limit: 100 });
    const ctx = makeContext([
      makeStep({ usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }),
      makeStep({ usage: null }),
      makeStep({ usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }),
    ]);
    assert.strictEqual(condition(ctx), false); // 40 < 100
  });
});

describe('executedTool', () => {
  it('returns false when not all tools have been executed', () => {
    const condition = executedTool({ toolNames: ['search', 'write'] });
    const ctx = makeContext([
      makeStep({
        tool_calls: [
          {
            id: '1',
            type: 'function',
            call_id: '1',
            function: { name: 'search', arguments: '{}' },
          },
        ],
      }),
    ]);
    assert.strictEqual(condition(ctx), false);
  });

  it('returns true when all tools have been executed', () => {
    const condition = executedTool({ toolNames: ['search', 'write'] });
    const ctx = makeContext([
      makeStep({
        tool_calls: [
          {
            id: '1',
            type: 'function',
            call_id: '1',
            function: { name: 'search', arguments: '{}' },
          },
        ],
      }),
      makeStep({
        tool_calls: [
          { id: '2', type: 'function', call_id: '2', function: { name: 'write', arguments: '{}' } },
        ],
      }),
    ]);
    assert.strictEqual(condition(ctx), true);
  });

  it('returns false for empty toolNames list', () => {
    const condition = executedTool({ toolNames: [] });
    const ctx = makeContext([makeStep()]);
    assert.strictEqual(condition(ctx), false);
  });
});

describe('hasText', () => {
  it('returns false when not all texts are found', () => {
    const condition = hasText({ texts: ['done', 'complete'] });
    const ctx = makeContext([makeStep({ content: 'The task is done' })]);
    assert.strictEqual(condition(ctx), false);
  });

  it('returns true when all texts are found across steps', () => {
    const condition = hasText({ texts: ['done', 'complete'] });
    const ctx = makeContext([
      makeStep({ content: 'The task is done' }),
      makeStep({ content: 'Everything is complete' }),
    ]);
    assert.strictEqual(condition(ctx), true);
  });

  it('returns false for empty texts list', () => {
    const condition = hasText({ texts: [] });
    const ctx = makeContext([makeStep({ content: 'anything' })]);
    assert.strictEqual(condition(ctx), false);
  });

  it('ignores steps with null content', () => {
    const condition = hasText({ texts: ['found'] });
    const ctx = makeContext([makeStep({ content: null }), makeStep({ content: 'found it' })]);
    assert.strictEqual(condition(ctx), true);
  });
});

describe('stopCondition factory', () => {
  it('creates a simple stop condition (no config, arity 1)', () => {
    const alwaysStop = stopCondition((ctx: StopConditionContext) => ctx.steps.length > 0);
    // alwaysStop is directly callable (StopCondition)
    assert.strictEqual(typeof alwaysStop, 'function');
    assert.strictEqual(alwaysStop(makeContext([makeStep()])), true);
    assert.strictEqual(alwaysStop(makeContext([])), false);
  });

  it('creates a factory stop condition (with config, arity 2)', () => {
    const myCondition = stopCondition(
      (ctx: StopConditionContext, config: { threshold: number }) =>
        ctx.steps.length >= config.threshold
    );

    // myCondition is a factory — call with config to get StopCondition
    const configured = myCondition({ threshold: 2 });
    assert.strictEqual(typeof configured, 'function');
    assert.strictEqual(configured(makeContext([makeStep()])), false);
    assert.strictEqual(configured(makeContext([makeStep(), makeStep()])), true);
  });

  it('attaches __stop_condition_fn__ metadata', () => {
    const named = stopCondition(function myStop(ctx: StopConditionContext) {
      return ctx.steps.length > 0;
    });
    assert.ok(named.__stop_condition_fn__);
    assert.strictEqual(named.__stop_condition_name__, 'myStop');
  });
});
