import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { LocalEnvironment } from '../local.js';

describe('LocalEnvironment', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polos-local-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('type', () => {
    it('has type "local"', () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      assert.strictEqual(env.type, 'local');
    });
  });

  describe('getCwd', () => {
    it('returns configured cwd', () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      assert.strictEqual(env.getCwd(), tmpDir);
    });

    it('defaults to process.cwd() when no cwd given', () => {
      const env = new LocalEnvironment();
      assert.strictEqual(env.getCwd(), process.cwd());
    });
  });

  describe('getInfo', () => {
    it('returns local environment info', () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      const info = env.getInfo();
      assert.strictEqual(info.type, 'local');
      assert.strictEqual(info.cwd, tmpDir);
    });
  });

  describe('initialize', () => {
    it('succeeds for existing directory', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize(); // Should not throw
    });

    it('throws for non-existent directory', async () => {
      const env = new LocalEnvironment({ cwd: path.join(tmpDir, 'nonexistent') });
      await assert.rejects(() => env.initialize(), /does not exist/);
    });

    it('throws if cwd is a file, not a directory', async () => {
      const filePath = path.join(tmpDir, 'afile.txt');
      await fs.writeFile(filePath, 'hello');
      const env = new LocalEnvironment({ cwd: filePath });
      await assert.rejects(() => env.initialize(), /not a directory/);
    });
  });

  describe('destroy', () => {
    it('is a no-op (does not throw)', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.destroy(); // Should not throw
    });
  });

  describe('exec', () => {
    it('runs a simple command', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const result = await env.exec('echo hello');
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout.trim(), 'hello');
      assert.ok(result.durationMs >= 0);
      assert.strictEqual(result.truncated, false);
    });

    it('captures stderr', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const result = await env.exec('echo err >&2');
      assert.ok(result.stderr.includes('err'));
    });

    it('returns non-zero exit code on failure', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const result = await env.exec('exit 42');
      assert.strictEqual(result.exitCode, 42);
    });

    it('respects cwd option', async () => {
      const subDir = path.join(tmpDir, 'sub');
      await fs.mkdir(subDir);

      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const result = await env.exec('pwd', { cwd: subDir });
      assert.strictEqual(result.stdout.trim(), subDir);
    });

    it('respects env option', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const result = await env.exec('echo $MY_VAR', {
        env: { MY_VAR: 'test123' },
      });
      assert.strictEqual(result.stdout.trim(), 'test123');
    });
  });

  describe('readFile', () => {
    it('reads a text file', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'file content');

      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const content = await env.readFile('test.txt');
      assert.strictEqual(content, 'file content');
    });

    it('reads file with absolute path', async () => {
      const filePath = path.join(tmpDir, 'abs.txt');
      await fs.writeFile(filePath, 'absolute');

      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const content = await env.readFile(filePath);
      assert.strictEqual(content, 'absolute');
    });

    it('throws for non-existent file', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      await assert.rejects(() => env.readFile('nonexistent.txt'));
    });
  });

  describe('writeFile', () => {
    it('writes a file', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      await env.writeFile('output.txt', 'written content');

      const content = await fs.readFile(path.join(tmpDir, 'output.txt'), 'utf-8');
      assert.strictEqual(content, 'written content');
    });

    it('creates parent directories', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      await env.writeFile('deep/nested/file.txt', 'nested');

      const content = await fs.readFile(path.join(tmpDir, 'deep', 'nested', 'file.txt'), 'utf-8');
      assert.strictEqual(content, 'nested');
    });
  });

  describe('fileExists', () => {
    it('returns true for existing file', async () => {
      await fs.writeFile(path.join(tmpDir, 'exists.txt'), '');

      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      assert.strictEqual(await env.fileExists('exists.txt'), true);
    });

    it('returns false for non-existent file', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      assert.strictEqual(await env.fileExists('nope.txt'), false);
    });
  });

  describe('glob', () => {
    it('finds files matching pattern', async () => {
      await fs.writeFile(path.join(tmpDir, 'a.ts'), '');
      await fs.writeFile(path.join(tmpDir, 'b.ts'), '');
      await fs.writeFile(path.join(tmpDir, 'c.js'), '');

      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const results = await env.glob('*.ts');
      assert.strictEqual(results.length, 2);
      assert.ok(results.some((r) => r.endsWith('a.ts')));
      assert.ok(results.some((r) => r.endsWith('b.ts')));
    });

    it('returns empty array when no matches', async () => {
      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const results = await env.glob('*.xyz');
      assert.deepStrictEqual(results, []);
    });
  });

  describe('grep', () => {
    it('finds pattern in files', async () => {
      await fs.writeFile(path.join(tmpDir, 'search.txt'), 'hello world\nfoo bar\nhello again');

      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const results = await env.grep('hello');
      assert.ok(results.length >= 2);
    });

    it('returns empty array when no matches', async () => {
      await fs.writeFile(path.join(tmpDir, 'search.txt'), 'nothing here');

      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const results = await env.grep('nonexistent_pattern_xyz');
      assert.deepStrictEqual(results, []);
    });
  });

  describe('path restriction', () => {
    it('allows file reads outside restricted path (tool layer handles approval)', async () => {
      // readFile no longer enforces path restriction — that's an approval gate
      // at the tool level. The environment only blocks symlinks.
      const outsideFile = path.join(os.tmpdir(), `polos-outside-test-${Date.now()}.txt`);
      await fs.writeFile(outsideFile, 'outside content');

      try {
        const env = new LocalEnvironment({
          cwd: tmpDir,
          pathRestriction: tmpDir,
        });
        await env.initialize();

        const content = await env.readFile(outsideFile);
        assert.strictEqual(content, 'outside content');
      } finally {
        await fs.unlink(outsideFile).catch(() => {});
      }
    });

    it('blocks file writes outside restricted path', async () => {
      const env = new LocalEnvironment({
        cwd: tmpDir,
        pathRestriction: tmpDir,
      });
      await env.initialize();

      await assert.rejects(() => env.writeFile('/tmp/evil.txt', 'bad'), /Path traversal detected/);
    });

    it('allows file operations within restricted path', async () => {
      const env = new LocalEnvironment({
        cwd: tmpDir,
        pathRestriction: tmpDir,
      });
      await env.initialize();

      await env.writeFile('allowed.txt', 'ok');
      const content = await env.readFile('allowed.txt');
      assert.strictEqual(content, 'ok');
    });

    it('blocks symlinks when path restriction is set', async () => {
      const realFile = path.join(tmpDir, 'real.txt');
      const linkFile = path.join(tmpDir, 'link.txt');
      await fs.writeFile(realFile, 'real content');
      await fs.symlink(realFile, linkFile);

      const env = new LocalEnvironment({
        cwd: tmpDir,
        pathRestriction: tmpDir,
      });
      await env.initialize();

      await assert.rejects(() => env.readFile('link.txt'), /Symbolic link detected/);
    });

    it('allows symlinks when path restriction is NOT set', async () => {
      const realFile = path.join(tmpDir, 'real.txt');
      const linkFile = path.join(tmpDir, 'link.txt');
      await fs.writeFile(realFile, 'real content');
      await fs.symlink(realFile, linkFile);

      const env = new LocalEnvironment({ cwd: tmpDir });
      await env.initialize();

      const content = await env.readFile('link.txt');
      assert.strictEqual(content, 'real content');
    });
  });
});
