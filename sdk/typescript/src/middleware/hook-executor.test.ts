import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { executeHookChain, composeHooks, conditionalHook } from './hook-executor.js';
import { HookResult, type Hook, type HookContext, type HookResultType } from './hook.js';
import type { WorkflowContext } from '../core/context.js';
import type { StepHelper } from '../core/step.js';

function createMockCtx(overrides?: Partial<WorkflowContext>): WorkflowContext {
  const stepRun = mock.fn(async (_key: string, fn: () => unknown) => fn());

  return {
    workflowId: 'test-wf',
    executionId: 'exec-1',
    deploymentId: 'deploy-1',
    rootExecutionId: 'exec-1',
    rootWorkflowId: 'test-wf',
    retryCount: 0,
    state: {},
    step: {
      run: stepRun,
    } as unknown as StepHelper,
    ...overrides,
  } as WorkflowContext;
}

describe('executeHookChain', () => {
  it('returns success with no hooks', async () => {
    const ctx = createMockCtx();
    const result = await executeHookChain(undefined, {
      ctx,
      hookName: 'on_start',
      payload: { foo: 1 },
      phase: 'onStart',
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hooksExecuted, 0);
    assert.deepStrictEqual(result.payload, { foo: 1 });
  });

  it('executes hooks in order', async () => {
    const order: number[] = [];
    const hooks: Hook[] = [
      {
        name: 'first',
        handler: async () => {
          order.push(1);
          return HookResult.continue();
        },
      },
      {
        name: 'second',
        handler: async () => {
          order.push(2);
          return HookResult.continue();
        },
      },
      {
        name: 'third',
        handler: async () => {
          order.push(3);
          return HookResult.continue();
        },
      },
    ];

    const ctx = createMockCtx();
    const result = await executeHookChain(hooks, {
      ctx,
      hookName: 'on_start',
      payload: {},
      phase: 'onStart',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hooksExecuted, 3);
    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  it('passes modified payload through chain', async () => {
    const hooks: Hook[] = [
      {
        name: 'modify',
        handler: async (_ctx, hookCtx) => {
          return HookResult.continueWith({
            modifiedPayload: { ...(hookCtx.currentPayload as object), added: true },
          });
        },
      },
      {
        name: 'check',
        handler: async (_ctx, hookCtx) => {
          // Verify the modified payload was passed
          assert.strictEqual((hookCtx.currentPayload as Record<string, unknown>)['added'], true);
          return HookResult.continue();
        },
      },
    ];

    const ctx = createMockCtx();
    const result = await executeHookChain(hooks, {
      ctx,
      hookName: 'on_start',
      payload: { original: true },
      phase: 'onStart',
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.payload, { original: true, added: true });
  });

  it('stops chain on failure and returns error', async () => {
    const hooks: Hook[] = [
      {
        name: 'pass',
        handler: async () => HookResult.continue(),
      },
      {
        name: 'blocker',
        handler: async () => HookResult.fail('blocked!'),
      },
      {
        name: 'never-reached',
        handler: async () => HookResult.continue(),
      },
    ];

    const ctx = createMockCtx();
    const result = await executeHookChain(hooks, {
      ctx,
      hookName: 'on_start',
      payload: {},
      phase: 'onStart',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'blocked!');
    assert.strictEqual(result.failedHook, 'blocker');
    assert.strictEqual(result.hooksExecuted, 2);
  });

  it('handles hooks that throw errors', async () => {
    const hooks: Hook[] = [
      {
        name: 'thrower',
        handler: async () => {
          throw new Error('kaboom');
        },
      },
    ];

    const ctx = createMockCtx();
    const result = await executeHookChain(hooks, {
      ctx,
      hookName: 'on_start',
      payload: {},
      phase: 'onStart',
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('kaboom'));
    assert.strictEqual(result.hooksExecuted, 1);
  });

  it('passes output through chain for onEnd hooks', async () => {
    const hooks: Hook[] = [
      {
        name: 'modify-output',
        handler: async () => {
          return HookResult.continueWith({ modifiedOutput: 'new output' });
        },
      },
    ];

    const ctx = createMockCtx();
    const result = await executeHookChain(hooks, {
      ctx,
      hookName: 'on_end',
      payload: {},
      output: 'original output',
      phase: 'onEnd',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.output, 'new output');
  });

  it('accepts bare handler functions', async () => {
    const handler = async (
      _ctx: WorkflowContext,
      _hookCtx: HookContext
    ): Promise<HookResultType> => {
      return HookResult.continue();
    };

    const ctx = createMockCtx();
    const result = await executeHookChain(handler, {
      ctx,
      hookName: 'on_start',
      payload: {},
      phase: 'onStart',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.hooksExecuted, 1);
  });
});

describe('composeHooks', () => {
  it('combines multiple hooks into one', async () => {
    const order: string[] = [];
    const hooks: Hook[] = [
      {
        name: 'a',
        handler: async () => {
          order.push('a');
          return HookResult.continue();
        },
      },
      {
        name: 'b',
        handler: async () => {
          order.push('b');
          return HookResult.continue();
        },
      },
    ];

    const composed = composeHooks(hooks);
    assert.ok(composed.name?.includes('a'));
    assert.ok(composed.name?.includes('b'));

    const ctx = createMockCtx();
    const result = await composed.handler(ctx, {
      workflowId: 'test',
      currentPayload: {},
      phase: 'onStart',
    });

    assert.strictEqual(result.continue, true);
    assert.deepStrictEqual(order, ['a', 'b']);
  });

  it('returns failure if any sub-hook fails', async () => {
    const hooks: Hook[] = [
      { name: 'ok', handler: async () => HookResult.continue() },
      { name: 'fail', handler: async () => HookResult.fail('nope') },
    ];

    const composed = composeHooks(hooks);
    const ctx = createMockCtx();
    const result = await composed.handler(ctx, {
      workflowId: 'test',
      currentPayload: {},
      phase: 'onStart',
    });

    assert.strictEqual(result.continue, false);
    assert.strictEqual(result.error, 'nope');
  });
});

describe('conditionalHook', () => {
  it('executes hook when condition is true', async () => {
    let ran = false;
    const hook: Hook = {
      name: 'inner',
      handler: async () => {
        ran = true;
        return HookResult.continue();
      },
    };

    const conditional = conditionalHook(() => true, hook);
    const ctx = createMockCtx();
    const result = await conditional.handler(ctx, {
      workflowId: 'test',
      currentPayload: {},
      phase: 'onStart',
    });

    assert.strictEqual(ran, true);
    assert.strictEqual(result.continue, true);
  });

  it('skips hook when condition is false', async () => {
    let ran = false;
    const hook: Hook = {
      name: 'inner',
      handler: async () => {
        ran = true;
        return HookResult.continue();
      },
    };

    const conditional = conditionalHook(() => false, hook);
    const ctx = createMockCtx();
    const result = await conditional.handler(ctx, {
      workflowId: 'test',
      currentPayload: {},
      phase: 'onStart',
    });

    assert.strictEqual(ran, false);
    assert.strictEqual(result.continue, true);
  });

  it('has descriptive name', () => {
    const hook: Hook = { name: 'inner', handler: async () => HookResult.continue() };
    const conditional = conditionalHook(() => true, hook);
    assert.strictEqual(conditional.name, 'conditional(inner)');
  });
});
