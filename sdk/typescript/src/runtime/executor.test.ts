import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeWorkflow } from './executor.js';
import type { ExecutionContext, StepOutput } from './orchestrator-types.js';
import type { OrchestratorClient } from './orchestrator-client.js';
import type { Workflow } from '../core/workflow.js';
import { WaitError, StepExecutionError } from '../core/step.js';
import { HookResult } from '../middleware/hook.js';
import { z } from 'zod';

function createMockOrchestratorClient(): OrchestratorClient {
  return {
    storeStepOutput: mock.fn(async () => undefined),
    getAllStepOutputs: mock.fn(async () => []),
    invokeWorkflow: mock.fn(async () => ({
      execution_id: 'sub-exec-1',
      created_at: new Date().toISOString(),
    })),
    batchInvokeWorkflows: mock.fn(async () => ({ executions: [] })),
    publishEvent: mock.fn(async () => ({ sequence_ids: [1] })),
    getApiUrl: mock.fn(() => 'http://localhost:8080'),
    setWaiting: mock.fn(async () => undefined),
    getExecution: mock.fn(async () => ({
      execution_id: 'exec-1',
      workflow_id: 'test-wf',
      status: 'completed' as const,
      result: 'done',
      created_at: new Date().toISOString(),
    })),
    waitForExecution: mock.fn(async () => ({
      execution_id: 'exec-1',
      workflow_id: 'test-wf',
      status: 'completed' as const,
      result: 'done',
      created_at: new Date().toISOString(),
    })),
    cancelExecution: mock.fn(async () => undefined),
    updateExecutionOtelSpanId: mock.fn(async () => undefined),
  } as unknown as OrchestratorClient;
}

function createExecContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    executionId: 'exec-1',
    deploymentId: 'deploy-1',
    retryCount: 0,
    ...overrides,
  };
}

function createWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: 'test-wf',
    config: { id: 'test-wf' },
    handler: async () => 'result',
    ...overrides,
  } as Workflow;
}

describe('executeWorkflow', () => {
  let mockClient: OrchestratorClient;

  beforeEach(() => {
    mockClient = createMockOrchestratorClient();
  });

  it('success path returns result and finalState', async () => {
    const workflow = createWorkflow({
      handler: async (ctx) => {
        ctx.state = { processed: true };
        return { answer: 42 };
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: { input: 'test' },
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.result, { answer: 42 });
    assert.deepStrictEqual(result.finalState, { processed: true });
  });

  it('handler error returns success=false with error and stack', async () => {
    const workflow = createWorkflow({
      handler: async () => {
        throw new Error('handler exploded');
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('handler exploded'));
    assert.ok(result.stack);
  });

  it('WaitError returns waiting=true', async () => {
    const workflow = createWorkflow({
      handler: async () => {
        throw new WaitError('waiting for event', { topic: 'test' });
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.waiting, true);
    assert.ok(result.error?.includes('waiting for event'));
  });

  it('initializes state from schema defaults', async () => {
    const stateSchema = z.object({
      count: z.number().default(0),
      label: z.string().default('start'),
    });

    let capturedState: unknown;
    const workflow = createWorkflow({
      stateSchema,
      handler: async (ctx) => {
        capturedState = { ...(ctx.state as Record<string, unknown>) };
        return 'ok';
      },
    });

    await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.deepStrictEqual(capturedState, { count: 0, label: 'start' });
  });

  it('uses initialState from context when provided', async () => {
    let capturedState: unknown;
    const workflow = createWorkflow({
      handler: async (ctx) => {
        capturedState = { ...(ctx.state as Record<string, unknown>) };
        return 'ok';
      },
    });

    await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext({ initialState: { preloaded: true } }),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.deepStrictEqual(capturedState, { preloaded: true });
  });

  it('validates payload against payloadSchema', async () => {
    const payloadSchema = z.object({ name: z.string() });
    const workflow = createWorkflow({
      payloadSchema,
      handler: async (_ctx, payload) => payload,
    });

    // Valid payload
    const validResult = await executeWorkflow({
      workflow,
      payload: { name: 'test' },
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });
    assert.strictEqual(validResult.success, true);

    // Invalid payload
    const invalidResult = await executeWorkflow({
      workflow,
      payload: { name: 123 },
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });
    assert.strictEqual(invalidResult.success, false);
    assert.ok(invalidResult.error);
  });

  it('executes onStart hooks', async () => {
    let hookRan = false;
    const workflow = createWorkflow({
      config: {
        id: 'test-wf',
        onStart: async () => {
          hookRan = true;
          return HookResult.continue();
        },
      },
      handler: async () => 'ok',
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(hookRan, true);
  });

  it('returns failure when onStart hook fails', async () => {
    const workflow = createWorkflow({
      config: {
        id: 'test-wf',
        onStart: async () => HookResult.fail('not allowed'),
      },
      handler: async () => 'ok',
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('not allowed'));
  });

  it('executes onEnd hooks', async () => {
    let hookRan = false;
    const workflow = createWorkflow({
      config: {
        id: 'test-wf',
        onEnd: async () => {
          hookRan = true;
          return HookResult.continue();
        },
      },
      handler: async () => 'result',
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(hookRan, true);
  });

  it('onEnd hook can modify output', async () => {
    const workflow = createWorkflow({
      config: {
        id: 'test-wf',
        onEnd: async () => HookResult.continueWith({ modifiedOutput: 'modified result' }),
      },
      handler: async () => 'original result',
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.result, 'modified result');
  });

  it('cancellation via abortSignal', async () => {
    const controller = new AbortController();
    controller.abort();

    const workflow = createWorkflow({
      handler: async () => 'should not reach',
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
      abortSignal: controller.signal,
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('cancelled'));
  });

  it('loads cached step outputs for replay', async () => {
    const cachedOutputs: StepOutput[] = [
      {
        stepKey: 'step-1',
        outputs: 'cached-value',
        completedAt: new Date().toISOString(),
        success: true,
      },
    ];

    const clientWithCache = createMockOrchestratorClient();
    (
      clientWithCache.getAllStepOutputs as unknown as ReturnType<typeof mock.fn>
    ).mock.mockImplementation(async () => cachedOutputs);

    let stepResult: unknown;
    const workflow = createWorkflow({
      handler: async (ctx) => {
        stepResult = await ctx.step.run('step-1', () => 'new-value');
        return 'done';
      },
    });

    await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: clientWithCache,
      workerId: 'worker-1',
    });

    // Should return cached value, not execute the function
    assert.strictEqual(stepResult, 'cached-value');
  });

  it('StepExecutionError is not retryable', async () => {
    const workflow = createWorkflow({
      handler: async () => {
        throw new StepExecutionError('step failed');
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.retryable, false);
  });

  it('tool workflows are not retryable', async () => {
    const workflow = createWorkflow({
      config: { id: 'test-tool', workflowType: 'tool' },
      handler: async () => {
        throw new Error('tool error');
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.retryable, false);
  });

  it('regular workflow errors are retryable', async () => {
    const workflow = createWorkflow({
      handler: async () => {
        throw new Error('transient error');
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.retryable, true);
  });
});

describe('step.run', () => {
  it('executes function and returns result', async () => {
    const mockClient = createMockOrchestratorClient();
    let stepResult: unknown;

    const workflow = createWorkflow({
      handler: async (ctx) => {
        stepResult = await ctx.step.run('compute', () => 42);
        return 'done';
      },
    });

    await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(stepResult, 42);
  });

  it('caches result and returns cached on replay', async () => {
    const mockClient = createMockOrchestratorClient();

    // First call: no cached steps, function runs
    let callCount = 0;
    const workflow = createWorkflow({
      handler: async (ctx) => {
        await ctx.step.run('step-a', () => {
          callCount++;
          return 'value';
        });
        // Call again with same key — should still use the cached value
        // from the local cache set during the first call
        const cached = await ctx.step.run('step-a', () => {
          callCount++;
          return 'value-2';
        });
        return cached;
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.result, 'value');
    assert.strictEqual(callCount, 1);
  });

  it('throws StepExecutionError on failed function after retries', async () => {
    const mockClient = createMockOrchestratorClient();

    const workflow = createWorkflow({
      handler: async (ctx) => {
        await ctx.step.run('fail-step', () => {
          throw new Error('always fails');
        });
        return 'should not reach';
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('always fails'));
  });
});

describe('step.uuid / step.now / step.random', () => {
  it('step.uuid returns a UUID string', async () => {
    const mockClient = createMockOrchestratorClient();
    let uuid: unknown;

    const workflow = createWorkflow({
      handler: async (ctx) => {
        uuid = await ctx.step.uuid('gen-id');
        return 'done';
      },
    });

    await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(typeof uuid, 'string');
    assert.ok((uuid as string).length > 0);
  });

  it('step.now returns a timestamp', async () => {
    const mockClient = createMockOrchestratorClient();
    let now: unknown;

    const workflow = createWorkflow({
      handler: async (ctx) => {
        now = await ctx.step.now('ts');
        return 'done';
      },
    });

    await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(typeof now, 'number');
    assert.ok((now as number) > 0);
  });

  it('step.random returns a number between 0 and 1', async () => {
    const mockClient = createMockOrchestratorClient();
    let rand: unknown;

    const workflow = createWorkflow({
      handler: async (ctx) => {
        rand = await ctx.step.random('rnd');
        return 'done';
      },
    });

    await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(typeof rand, 'number');
    assert.ok((rand as number) >= 0);
    assert.ok((rand as number) < 1);
  });

  it('deterministic on replay — returns cached value', async () => {
    const cachedUuid = 'cached-uuid-123';
    const mockClient = createMockOrchestratorClient();
    (mockClient.getAllStepOutputs as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => [
        {
          stepKey: 'gen-id',
          outputs: cachedUuid,
          completedAt: new Date().toISOString(),
          success: true,
        },
      ]
    );

    let uuid: unknown;
    const workflow = createWorkflow({
      handler: async (ctx) => {
        uuid = await ctx.step.uuid('gen-id');
        return 'done';
      },
    });

    await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(uuid, cachedUuid);
  });
});

describe('step.invokeAndWait', () => {
  it('throws WaitError for new invocations', async () => {
    const mockClient = createMockOrchestratorClient();

    const workflow = createWorkflow({
      handler: async (ctx) => {
        await ctx.step.invokeAndWait('invoke-sub', 'sub-workflow', { data: 'test' });
        return 'done';
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.waiting, true);
  });

  it('returns cached result on replay', async () => {
    const mockClient = createMockOrchestratorClient();
    (mockClient.getAllStepOutputs as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => [
        {
          stepKey: 'invoke-sub',
          outputs: { answer: 42 },
          completedAt: new Date().toISOString(),
          success: true,
        },
      ]
    );

    let subResult: unknown;
    const workflow = createWorkflow({
      handler: async (ctx) => {
        subResult = await ctx.step.invokeAndWait('invoke-sub', 'sub-workflow', {});
        return 'done';
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(subResult, { answer: 42 });
  });
});

describe('step.suspend', () => {
  it('publishes event, sets waiting, and throws WaitError', async () => {
    const mockClient = createMockOrchestratorClient();

    const workflow = createWorkflow({
      handler: async (ctx) => {
        await ctx.step.suspend('wait-for-approval', { data: { requestId: '123' } });
        return 'resumed';
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.waiting, true);

    // Verify publishEvent and setWaiting were called
    const publishCalls = (mockClient.publishEvent as unknown as ReturnType<typeof mock.fn>).mock
      .calls;
    assert.ok(publishCalls.length >= 1);

    const setWaitingCalls = (mockClient.setWaiting as unknown as ReturnType<typeof mock.fn>).mock
      .calls;
    assert.ok(setWaitingCalls.length >= 1);
  });
});

describe('step.batchInvokeAndWait', () => {
  it('preserves BatchStepResult wrapper from orchestrator', async () => {
    const mockClient = createMockOrchestratorClient();
    (mockClient.getAllStepOutputs as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => [
        {
          stepKey: 'batch-key',
          outputs: [
            { workflow_id: 'wf-a', success: true, result: 'result-a' },
            { workflow_id: 'wf-b', success: true, result: 'result-b' },
          ],
          completedAt: new Date().toISOString(),
          success: true,
        },
      ]
    );

    let batchResults: unknown;
    const workflow = createWorkflow({
      handler: async (ctx) => {
        batchResults = await ctx.step.batchInvokeAndWait('batch-key', [
          { workflow: 'wf-a', payload: {} },
          { workflow: 'wf-b', payload: {} },
        ]);
        return 'done';
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(batchResults, [
      { workflowId: 'wf-a', success: true, result: 'result-a', error: null },
      { workflowId: 'wf-b', success: true, result: 'result-b', error: null },
    ]);
  });

  it('preserves error info for failed batch items', async () => {
    const mockClient = createMockOrchestratorClient();
    (mockClient.getAllStepOutputs as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => [
        {
          stepKey: 'batch-key',
          outputs: [
            { workflow_id: 'wf-a', success: true, result: 'result-a' },
            {
              workflow_id: 'wf-b',
              success: false,
              result: null,
              error: 'Tool "web_search" was rejected by the user.',
            },
          ],
          completedAt: new Date().toISOString(),
          success: true,
        },
      ]
    );

    let batchResults: unknown;
    const workflow = createWorkflow({
      handler: async (ctx) => {
        batchResults = await ctx.step.batchInvokeAndWait('batch-key', [
          { workflow: 'wf-a', payload: {} },
          { workflow: 'wf-b', payload: {} },
        ]);
        return 'done';
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(batchResults, [
      { workflowId: 'wf-a', success: true, result: 'result-a', error: null },
      {
        workflowId: 'wf-b',
        success: false,
        result: null,
        error: 'Tool "web_search" was rejected by the user.',
      },
    ]);
  });

  it('recovers from step-level failure when sub-workflows have per-item errors', async () => {
    const mockClient = createMockOrchestratorClient();
    // Simulate what the orchestrator does: step-level success=false with error,
    // but outputs still contain per-item results with individual success flags
    (mockClient.getAllStepOutputs as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => [
        {
          stepKey: 'batch-key',
          outputs: [
            { workflow_id: 'wf-a', success: true, result: 'result-a' },
            { workflow_id: 'wf-b', success: false, result: null, error: 'Tool rejected by user' },
          ],
          completedAt: new Date().toISOString(),
          success: false,
          error: { message: 'Tool rejected by user' },
        },
      ]
    );

    let batchResults: unknown;
    const workflow = createWorkflow({
      handler: async (ctx) => {
        batchResults = await ctx.step.batchInvokeAndWait('batch-key', [
          { workflow: 'wf-a', payload: {} },
          { workflow: 'wf-b', payload: {} },
        ]);
        return 'done';
      },
    });

    const result = await executeWorkflow({
      workflow,
      payload: {},
      context: createExecContext(),
      orchestratorClient: mockClient,
      workerId: 'worker-1',
    });

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(batchResults, [
      { workflowId: 'wf-a', success: true, result: 'result-a', error: null },
      { workflowId: 'wf-b', success: false, result: null, error: 'Tool rejected by user' },
    ]);
  });
});
