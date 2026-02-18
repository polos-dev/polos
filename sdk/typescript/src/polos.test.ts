import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Polos } from './polos.js';
import { globalRegistry } from './core/registry.js';
import type { WorkflowRunClient } from './core/workflow.js';

describe('Polos', () => {
  // Save and restore env vars around tests
  const envBackup: Record<string, string | undefined> = {};
  const envKeys = ['POLOS_PROJECT_ID', 'POLOS_API_URL', 'POLOS_API_KEY', 'POLOS_DEPLOYMENT_ID'];

  beforeEach(() => {
    for (const key of envKeys) {
      envBackup[key] = process.env[key];
    }
    // Clear registry to avoid leaking between tests
    globalRegistry.clear();
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
    globalRegistry.clear();
  });

  describe('constructor defaults', () => {
    it('uses env vars when no config is provided', () => {
      process.env['POLOS_PROJECT_ID'] = 'env-project';
      process.env['POLOS_API_URL'] = 'http://env-host:9090';
      process.env['POLOS_API_KEY'] = 'env-key';
      process.env['POLOS_DEPLOYMENT_ID'] = 'env-deploy';

      const polos = new Polos();
      // The Polos class should have been constructed without errors.
      // We verify it exposes events and schedules sub-APIs.
      assert.ok(polos.events);
      assert.ok(polos.schedules);
    });

    it('uses explicit config over env vars', () => {
      process.env['POLOS_API_URL'] = 'http://env-host:9090';

      const polos = new Polos({
        projectId: 'my-project',
        apiUrl: 'http://explicit:8080',
        apiKey: 'explicit-key',
        deploymentId: 'explicit-deploy',
        port: 9000,
      });

      assert.ok(polos.events);
      assert.ok(polos.schedules);
    });

    it('falls back to defaults when no env vars or config', () => {
      delete process.env['POLOS_PROJECT_ID'];
      delete process.env['POLOS_API_URL'];
      delete process.env['POLOS_API_KEY'];
      delete process.env['POLOS_DEPLOYMENT_ID'];

      // Should not throw — uses empty/default values
      const polos = new Polos();
      assert.ok(polos);
    });
  });

  describe('WorkflowRunClient interface', () => {
    it('structurally satisfies WorkflowRunClient', () => {
      const polos = new Polos();
      // WorkflowRunClient requires invoke(workflow, payload?, options?) => Promise<{ getResult }>
      const client: WorkflowRunClient = polos;
      assert.ok(typeof client.invoke === 'function');
    });
  });

  describe('start() idempotency', () => {
    it('failed start does not leave object in bad state', async () => {
      // Use a port that immediately refuses connections so this test is fast.
      const polos = new Polos({ apiUrl: 'http://127.0.0.1:1' });
      // start() will fail because there's no orchestrator at port 1.
      await assert.rejects(async () => polos.start());
      // After a failed start, stop() should still be a safe no-op.
      await polos.stop();
      // And we can attempt start again (it will fail again, but doesn't throw differently).
      await assert.rejects(async () => polos.start());
    });
  });

  describe('stop() when not started', () => {
    it('stop() is a no-op when not started', async () => {
      const polos = new Polos();
      // Should not throw
      await polos.stop();
    });
  });

  describe('sub-API delegation', () => {
    it('exposes events API with expected methods', () => {
      const polos = new Polos();
      assert.ok(typeof polos.events.publish === 'function');
      assert.ok(typeof polos.events.batchPublish === 'function');
      assert.ok(typeof polos.events.streamTopic === 'function');
      assert.ok(typeof polos.events.streamWorkflow === 'function');
    });

    it('exposes schedules API with expected methods', () => {
      const polos = new Polos();
      assert.ok(typeof polos.schedules.create === 'function');
    });
  });

  describe('client delegation methods', () => {
    it('exposes invoke, batchInvoke, resume, getExecution, cancelExecution', () => {
      const polos = new Polos();
      assert.ok(typeof polos.invoke === 'function');
      assert.ok(typeof polos.batchInvoke === 'function');
      assert.ok(typeof polos.resume === 'function');
      assert.ok(typeof polos.getExecution === 'function');
      assert.ok(typeof polos.cancelExecution === 'function');
    });
  });
});
