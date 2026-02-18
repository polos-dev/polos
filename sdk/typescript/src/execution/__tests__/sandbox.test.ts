import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ManagedSandbox } from '../sandbox.js';
import type { SandboxConfig, ExecutionEnvironment, ExecResult } from '../types.js';

/** Create a mock ExecutionEnvironment. */
function createMockEnv(overrides?: Partial<ExecutionEnvironment>): ExecutionEnvironment {
  return {
    type: 'docker' as const,
    exec: mock.fn(
      async (): Promise<ExecResult> => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 1,
        truncated: false,
      })
    ),
    readFile: mock.fn(async () => ''),
    writeFile: mock.fn(async () => undefined),
    fileExists: mock.fn(async () => false),
    glob: mock.fn(async () => []),
    grep: mock.fn(async () => []),
    initialize: mock.fn(async () => undefined),
    destroy: mock.fn(async () => undefined),
    getCwd: mock.fn(() => '/workspace'),
    getInfo: mock.fn(() => ({ type: 'docker' as const, cwd: '/workspace' })),
    ...overrides,
  } as unknown as ExecutionEnvironment;
}

describe('ManagedSandbox', () => {
  const defaultConfig: SandboxConfig = {
    env: 'local',
    local: { cwd: '/tmp' },
  };

  describe('constructor', () => {
    it('auto-generates an id when not provided', () => {
      const sandbox = new ManagedSandbox(defaultConfig, 'worker-1', 'test-project');
      assert.ok(sandbox.id.startsWith('sandbox-'));
    });

    it('uses provided id', () => {
      const sandbox = new ManagedSandbox(
        { ...defaultConfig, id: 'my-sandbox' },
        'worker-1',
        'test-project'
      );
      assert.strictEqual(sandbox.id, 'my-sandbox');
    });

    it('defaults scope to execution', () => {
      const sandbox = new ManagedSandbox(defaultConfig, 'worker-1', 'test-project');
      assert.strictEqual(sandbox.scope, 'execution');
    });

    it('respects provided scope', () => {
      const sandbox = new ManagedSandbox(
        { ...defaultConfig, scope: 'session' },
        'worker-1',
        'test-project'
      );
      assert.strictEqual(sandbox.scope, 'session');
    });

    it('stores workerId and sessionId', () => {
      const sandbox = new ManagedSandbox(defaultConfig, 'worker-1', 'test-project', 'sess-abc');
      assert.strictEqual(sandbox.workerId, 'worker-1');
      assert.strictEqual(sandbox.sessionId, 'sess-abc');
    });

    it('starts not initialized and not destroyed', () => {
      const sandbox = new ManagedSandbox(defaultConfig, 'worker-1', 'test-project');
      assert.strictEqual(sandbox.initialized, false);
      assert.strictEqual(sandbox.destroyed, false);
    });
  });

  describe('attachExecution / detachExecution', () => {
    it('tracks active execution IDs', () => {
      const sandbox = new ManagedSandbox(defaultConfig, 'worker-1', 'test-project');
      sandbox.attachExecution('exec-1');
      sandbox.attachExecution('exec-2');

      assert.strictEqual(sandbox.activeExecutionIds.size, 2);
      assert.ok(sandbox.activeExecutionIds.has('exec-1'));
      assert.ok(sandbox.activeExecutionIds.has('exec-2'));
    });

    it('detach removes execution IDs', () => {
      const sandbox = new ManagedSandbox(defaultConfig, 'worker-1', 'test-project');
      sandbox.attachExecution('exec-1');
      sandbox.attachExecution('exec-2');
      sandbox.detachExecution('exec-1');

      assert.strictEqual(sandbox.activeExecutionIds.size, 1);
      assert.ok(!sandbox.activeExecutionIds.has('exec-1'));
      assert.ok(sandbox.activeExecutionIds.has('exec-2'));
    });

    it('detach is safe for unknown execution ID', () => {
      const sandbox = new ManagedSandbox(defaultConfig, 'worker-1', 'test-project');
      sandbox.detachExecution('nonexistent');
      assert.strictEqual(sandbox.activeExecutionIds.size, 0);
    });
  });

  describe('getEnvironment', () => {
    it('creates local environment for env: local', async () => {
      const sandbox = new ManagedSandbox(
        { env: 'local', local: { cwd: '/tmp' } },
        'worker-1',
        'test-project'
      );

      const env = await sandbox.getEnvironment();
      assert.strictEqual(env.type, 'local');
      assert.strictEqual(sandbox.initialized, true);
    });

    it('updates lastActivityAt on each call', async () => {
      const sandbox = new ManagedSandbox(
        { env: 'local', local: { cwd: '/tmp' } },
        'worker-1',
        'test-project'
      );

      const before = sandbox.lastActivityAt;
      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      await sandbox.getEnvironment();
      const after = sandbox.lastActivityAt;
      assert.ok(after.getTime() >= before.getTime());
    });

    it('throws if sandbox is destroyed', async () => {
      const sandbox = new ManagedSandbox(
        { env: 'local', local: { cwd: '/tmp' } },
        'worker-1',
        'test-project'
      );
      await sandbox.destroy();
      await assert.rejects(() => sandbox.getEnvironment(), /has been destroyed/);
    });

    it('throws for e2b environment', async () => {
      const sandbox = new ManagedSandbox({ env: 'e2b' }, 'worker-1', 'test-project');
      await assert.rejects(() => sandbox.getEnvironment(), /not yet implemented/);
    });

    it('coalesces concurrent init calls', async () => {
      const sandbox = new ManagedSandbox(
        { env: 'local', local: { cwd: '/tmp' } },
        'worker-1',
        'test-project'
      );

      // Fire two concurrent calls
      const [env1, env2] = await Promise.all([sandbox.getEnvironment(), sandbox.getEnvironment()]);

      // Should return the same instance
      assert.strictEqual(env1, env2);
    });
  });

  describe('destroy', () => {
    it('sets destroyed to true', async () => {
      const sandbox = new ManagedSandbox(
        { env: 'local', local: { cwd: '/tmp' } },
        'worker-1',
        'test-project'
      );
      await sandbox.getEnvironment();
      await sandbox.destroy();
      assert.strictEqual(sandbox.destroyed, true);
    });

    it('is idempotent', async () => {
      const sandbox = new ManagedSandbox(
        { env: 'local', local: { cwd: '/tmp' } },
        'worker-1',
        'test-project'
      );
      await sandbox.destroy();
      await sandbox.destroy(); // second call should not throw
      assert.strictEqual(sandbox.destroyed, true);
    });

    it('is safe to call before initialization', async () => {
      const sandbox = new ManagedSandbox(defaultConfig, 'worker-1', 'test-project');
      await sandbox.destroy();
      assert.strictEqual(sandbox.destroyed, true);
    });
  });

  describe('recreate', () => {
    it('clears destroyed state so getEnvironment works again', async () => {
      const sandbox = new ManagedSandbox(
        { env: 'local', local: { cwd: '/tmp' } },
        'worker-1',
        'test-project'
      );
      await sandbox.getEnvironment();
      await sandbox.destroy();
      assert.strictEqual(sandbox.destroyed, true);

      await sandbox.recreate();
      assert.strictEqual(sandbox.destroyed, false);

      // Should be able to get a new environment
      const env = await sandbox.getEnvironment();
      assert.ok(env);
      assert.strictEqual(env.type, 'local');
    });
  });
});
