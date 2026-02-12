import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DockerEnvironment } from '../docker.js';
import type { DockerEnvironmentConfig } from '../types.js';

describe('DockerEnvironment', () => {
  const defaultConfig: DockerEnvironmentConfig = {
    image: 'node:20-slim',
    workspaceDir: '/tmp/test-workspace',
  };

  describe('path translation', () => {
    it('toHostPath translates container paths to host paths', () => {
      const env = new DockerEnvironment(defaultConfig);
      const hostPath = env.toHostPath('/workspace/src/main.ts');
      assert.strictEqual(hostPath, '/tmp/test-workspace/src/main.ts');
    });

    it('toHostPath handles root workspace path', () => {
      const env = new DockerEnvironment(defaultConfig);
      const hostPath = env.toHostPath('/workspace');
      assert.strictEqual(hostPath, '/tmp/test-workspace');
    });

    it('toHostPath handles relative path within workspace', () => {
      const env = new DockerEnvironment(defaultConfig);
      const hostPath = env.toHostPath('/workspace/./src/../src/main.ts');
      assert.strictEqual(hostPath, '/tmp/test-workspace/src/main.ts');
    });

    it('toHostPath rejects path traversal', () => {
      const env = new DockerEnvironment(defaultConfig);
      assert.throws(() => env.toHostPath('/workspace/../etc/passwd'), /Path traversal detected/);
    });

    it('toHostPath rejects absolute paths outside workspace', () => {
      const env = new DockerEnvironment(defaultConfig);
      assert.throws(() => env.toHostPath('/etc/passwd'), /Path traversal detected/);
    });

    it('toContainerPath translates host paths to container paths', () => {
      const env = new DockerEnvironment(defaultConfig);
      const containerPath = env.toContainerPath('/tmp/test-workspace/src/main.ts');
      assert.strictEqual(containerPath, '/workspace/src/main.ts');
    });

    it('toContainerPath rejects paths outside workspace', () => {
      const env = new DockerEnvironment(defaultConfig);
      assert.throws(() => env.toContainerPath('/other/path/file.ts'), /Path outside workspace/);
    });

    it('respects custom containerWorkdir', () => {
      const env = new DockerEnvironment({
        ...defaultConfig,
        containerWorkdir: '/app',
      });
      const hostPath = env.toHostPath('/app/src/main.ts');
      assert.strictEqual(hostPath, '/tmp/test-workspace/src/main.ts');
    });

    it('custom containerWorkdir rejects traversal', () => {
      const env = new DockerEnvironment({
        ...defaultConfig,
        containerWorkdir: '/app',
      });
      assert.throws(() => env.toHostPath('/app/../etc/passwd'), /Path traversal detected/);
    });
  });

  describe('getCwd', () => {
    it('returns default container workdir', () => {
      const env = new DockerEnvironment(defaultConfig);
      assert.strictEqual(env.getCwd(), '/workspace');
    });

    it('returns custom workdir', () => {
      const env = new DockerEnvironment({
        ...defaultConfig,
        containerWorkdir: '/app',
      });
      assert.strictEqual(env.getCwd(), '/app');
    });
  });

  describe('getInfo', () => {
    it('returns environment info before init', () => {
      const env = new DockerEnvironment(defaultConfig);
      const info = env.getInfo();
      assert.strictEqual(info.type, 'docker');
      assert.strictEqual(info.cwd, '/workspace');
      assert.strictEqual(info.sandboxId, undefined);
    });

    it('returns custom workdir in info', () => {
      const env = new DockerEnvironment({
        ...defaultConfig,
        containerWorkdir: '/app',
      });
      const info = env.getInfo();
      assert.strictEqual(info.cwd, '/app');
    });
  });

  describe('type', () => {
    it('has type "docker"', () => {
      const env = new DockerEnvironment(defaultConfig);
      assert.strictEqual(env.type, 'docker');
    });
  });

  describe('exec', () => {
    it('throws if not initialized', async () => {
      const env = new DockerEnvironment(defaultConfig);
      await assert.rejects(() => env.exec('echo hello'), /not initialized/);
    });
  });

  describe('destroy', () => {
    it('is safe to call without initialization', async () => {
      const env = new DockerEnvironment(defaultConfig);
      // Should not throw when no container exists
      await env.destroy();
    });
  });
});
