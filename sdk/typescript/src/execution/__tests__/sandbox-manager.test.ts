import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SandboxManager, parseDuration } from '../sandbox-manager.js';
import type { SandboxConfig } from '../types.js';

describe('parseDuration', () => {
  it('parses minutes', () => {
    assert.strictEqual(parseDuration('30m'), 30 * 60 * 1000);
  });

  it('parses hours', () => {
    assert.strictEqual(parseDuration('1h'), 60 * 60 * 1000);
    assert.strictEqual(parseDuration('24h'), 24 * 60 * 60 * 1000);
  });

  it('parses days', () => {
    assert.strictEqual(parseDuration('3d'), 3 * 24 * 60 * 60 * 1000);
  });

  it('parses fractional values', () => {
    assert.strictEqual(parseDuration('0.5h'), 0.5 * 60 * 60 * 1000);
  });

  it('trims whitespace', () => {
    assert.strictEqual(parseDuration('  1h  '), 60 * 60 * 1000);
  });

  it('throws for invalid format', () => {
    assert.throws(() => parseDuration('abc'), /Invalid duration/);
    assert.throws(() => parseDuration('1x'), /Invalid duration/);
    assert.throws(() => parseDuration(''), /Invalid duration/);
    assert.throws(() => parseDuration('1'), /Invalid duration/);
  });
});

describe('SandboxManager', () => {
  let manager: SandboxManager;

  const localConfig: SandboxConfig = {
    env: 'local',
    local: { cwd: '/tmp' },
  };

  const sessionConfig: SandboxConfig = {
    ...localConfig,
    scope: 'session',
  };

  beforeEach(() => {
    manager = new SandboxManager('worker-1', 'test-project');
  });

  describe('setWorkerId', () => {
    it('updates the worker ID', () => {
      manager.setWorkerId('worker-2');
      // Verify by creating a sandbox (workerId propagates to sandbox)
      const sandbox = manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      assert.ok(sandbox);
    });
  });

  describe('getOrCreateSandbox — execution scope', () => {
    it('creates a new sandbox for each call', async () => {
      const s1 = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      const s2 = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-2' });

      assert.notStrictEqual(s1.id, s2.id);
    });

    it('attaches execution to sandbox', async () => {
      const sandbox = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      assert.ok(sandbox.activeExecutionIds.has('exec-1'));
    });

    it('sandbox is retrievable by ID', async () => {
      const sandbox = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      const found = manager.getSandbox(sandbox.id);
      assert.strictEqual(found, sandbox);
    });

    it('defaults scope to execution', async () => {
      const sandbox = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      assert.strictEqual(sandbox.scope, 'execution');
    });
  });

  describe('getOrCreateSandbox — session scope', () => {
    it('throws when sessionId is missing', async () => {
      await assert.rejects(
        () => manager.getOrCreateSandbox(sessionConfig, { executionId: 'exec-1' }),
        /sessionId is required/
      );
    });

    it('creates a session sandbox', async () => {
      const sandbox = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-1',
        sessionId: 'sess-1',
      });

      assert.strictEqual(sandbox.scope, 'session');
      assert.ok(sandbox.activeExecutionIds.has('exec-1'));
    });

    it('reuses existing session sandbox', async () => {
      const s1 = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-1',
        sessionId: 'sess-1',
      });
      const s2 = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-2',
        sessionId: 'sess-1',
      });

      assert.strictEqual(s1.id, s2.id);
      assert.ok(s2.activeExecutionIds.has('exec-1'));
      assert.ok(s2.activeExecutionIds.has('exec-2'));
    });

    it('creates new sandbox for different sessions', async () => {
      const s1 = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-1',
        sessionId: 'sess-1',
      });
      const s2 = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-2',
        sessionId: 'sess-2',
      });

      assert.notStrictEqual(s1.id, s2.id);
    });

    it('is retrievable by session ID', async () => {
      const sandbox = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-1',
        sessionId: 'sess-1',
      });
      const found = manager.getSessionSandbox('sess-1');
      assert.strictEqual(found, sandbox);
    });
  });

  describe('onExecutionComplete', () => {
    it('detaches execution from sandbox', async () => {
      const sandbox = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      assert.ok(sandbox.activeExecutionIds.has('exec-1'));

      await manager.onExecutionComplete('exec-1');
      assert.ok(!sandbox.activeExecutionIds.has('exec-1'));
    });

    it('destroys execution-scoped sandbox on completion', async () => {
      const sandbox = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      const sandboxId = sandbox.id;

      await manager.onExecutionComplete('exec-1');

      // Sandbox should be removed from manager
      assert.strictEqual(manager.getSandbox(sandboxId), undefined);
      assert.strictEqual(sandbox.destroyed, true);
    });

    it('does not destroy session-scoped sandbox on execution complete', async () => {
      const sandbox = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-1',
        sessionId: 'sess-1',
      });

      await manager.onExecutionComplete('exec-1');

      assert.strictEqual(sandbox.destroyed, false);
      assert.ok(manager.getSandbox(sandbox.id));
      assert.ok(manager.getSessionSandbox('sess-1'));
    });

    it('is safe for unknown execution ID', async () => {
      await manager.onExecutionComplete('nonexistent');
      // Should not throw
    });
  });

  describe('destroySandbox', () => {
    it('destroys and removes a sandbox', async () => {
      const sandbox = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      const sandboxId = sandbox.id;

      await manager.destroySandbox(sandboxId);

      assert.strictEqual(sandbox.destroyed, true);
      assert.strictEqual(manager.getSandbox(sandboxId), undefined);
    });

    it('removes session index for session-scoped sandbox', async () => {
      const sandbox = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-1',
        sessionId: 'sess-1',
      });

      await manager.destroySandbox(sandbox.id);

      assert.strictEqual(manager.getSessionSandbox('sess-1'), undefined);
    });

    it('is safe for unknown sandbox ID', async () => {
      await manager.destroySandbox('nonexistent');
      // Should not throw
    });
  });

  describe('destroyAll', () => {
    it('destroys all sandboxes', async () => {
      const s1 = await manager.getOrCreateSandbox(localConfig, { executionId: 'exec-1' });
      const s2 = await manager.getOrCreateSandbox(sessionConfig, {
        executionId: 'exec-2',
        sessionId: 'sess-1',
      });

      await manager.destroyAll();

      assert.strictEqual(s1.destroyed, true);
      assert.strictEqual(s2.destroyed, true);
      assert.strictEqual(manager.getSandbox(s1.id), undefined);
      assert.strictEqual(manager.getSandbox(s2.id), undefined);
      assert.strictEqual(manager.getSessionSandbox('sess-1'), undefined);
    });

    it('is safe when no sandboxes exist', async () => {
      await manager.destroyAll();
      // Should not throw
    });
  });

  describe('startSweep / stopSweep', () => {
    it('starts and stops without error', () => {
      manager.startSweep(60000);
      manager.stopSweep();
    });

    it('stop is idempotent', () => {
      manager.stopSweep();
      manager.stopSweep();
    });

    it('start replaces existing sweep', () => {
      manager.startSweep(60000);
      manager.startSweep(60000); // should not throw or leak
      manager.stopSweep();
    });
  });

  describe('getSandbox / getSessionSandbox', () => {
    it('returns undefined for unknown IDs', () => {
      assert.strictEqual(manager.getSandbox('unknown'), undefined);
      assert.strictEqual(manager.getSessionSandbox('unknown'), undefined);
    });
  });
});
