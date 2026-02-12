import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { matchGlob, evaluateAllowlist, assertSafePath } from '../security.js';

describe('matchGlob', () => {
  it('matches exact strings', () => {
    assert.strictEqual(matchGlob('ls', 'ls'), true);
    assert.strictEqual(matchGlob('pwd', 'pwd'), true);
  });

  it('does not match different strings', () => {
    assert.strictEqual(matchGlob('ls', 'pwd'), false);
    assert.strictEqual(matchGlob('rm', 'ls'), false);
  });

  it('matches wildcard at end', () => {
    assert.strictEqual(matchGlob('node hello.js', 'node *'), true);
    assert.strictEqual(matchGlob('node server.js', 'node *'), true);
    assert.strictEqual(matchGlob('npm install', 'npm *'), true);
  });

  it('matches full wildcard', () => {
    assert.strictEqual(matchGlob('anything', '*'), true);
    assert.strictEqual(matchGlob('ls -la', '*'), true);
    assert.strictEqual(matchGlob('', '*'), true);
  });

  it('matches wildcard in middle', () => {
    assert.strictEqual(matchGlob('npm run test', 'npm * test'), true);
    assert.strictEqual(matchGlob('npm run build', 'npm * build'), true);
    assert.strictEqual(matchGlob('npm run build', 'npm * test'), false);
  });

  it('matches multiple wildcards', () => {
    assert.strictEqual(matchGlob('npm run test', 'npm * *'), true);
    assert.strictEqual(matchGlob('a b c', '* * *'), true);
  });

  it('handles regex special characters in patterns', () => {
    assert.strictEqual(matchGlob('cat file.txt', 'cat file.txt'), true);
    assert.strictEqual(matchGlob('cat file.txt', 'cat filetxt'), false);
    assert.strictEqual(matchGlob('echo (hello)', 'echo (hello)'), true);
  });

  it('does not match partial strings without wildcard', () => {
    assert.strictEqual(matchGlob('node hello.js', 'node'), false);
    assert.strictEqual(matchGlob('ls', 'ls -la'), false);
  });
});

describe('evaluateAllowlist', () => {
  it('matches exact command in allowlist', () => {
    assert.strictEqual(evaluateAllowlist('ls', ['ls', 'pwd', 'whoami']), true);
  });

  it('matches glob pattern in allowlist', () => {
    assert.strictEqual(evaluateAllowlist('node server.js', ['node *', 'npm *']), true);
  });

  it('returns false when no pattern matches', () => {
    assert.strictEqual(evaluateAllowlist('rm -rf /', ['ls', 'node *', 'npm *']), false);
  });

  it('returns false for empty allowlist', () => {
    assert.strictEqual(evaluateAllowlist('ls', []), false);
  });

  it('matches full wildcard pattern', () => {
    assert.strictEqual(evaluateAllowlist('anything here', ['*']), true);
  });

  it('trims whitespace from command', () => {
    assert.strictEqual(evaluateAllowlist('  ls  ', ['ls']), true);
    assert.strictEqual(evaluateAllowlist('  node app.js  ', ['node *']), true);
  });

  it('does not match partial commands without wildcard', () => {
    assert.strictEqual(evaluateAllowlist('npm install', ['npm']), false);
    assert.strictEqual(evaluateAllowlist('node', ['node *']), false);
  });
});

describe('assertSafePath', () => {
  it('allows paths within the restriction directory', () => {
    assert.doesNotThrow(() => assertSafePath('foo/bar.txt', '/workspace'));
    assert.doesNotThrow(() => assertSafePath('src/index.ts', '/workspace'));
    assert.doesNotThrow(() => assertSafePath('a/b/c/d.txt', '/workspace'));
  });

  it('allows the restriction directory itself', () => {
    assert.doesNotThrow(() => assertSafePath('.', '/workspace'));
    assert.doesNotThrow(() => assertSafePath('', '/workspace'));
  });

  it('allows paths with safe relative segments', () => {
    assert.doesNotThrow(() => assertSafePath('foo/../bar.txt', '/workspace'));
    assert.doesNotThrow(() => assertSafePath('./foo/bar.txt', '/workspace'));
  });

  it('throws on directory traversal', () => {
    assert.throws(
      () => assertSafePath('../../etc/passwd', '/workspace'),
      /Path traversal detected/
    );
    assert.throws(() => assertSafePath('../outside.txt', '/workspace'), /Path traversal detected/);
  });

  it('throws on absolute paths outside restriction', () => {
    assert.throws(() => assertSafePath('/etc/passwd', '/workspace'), /Path traversal detected/);
    assert.throws(() => assertSafePath('/tmp/evil.sh', '/workspace'), /Path traversal detected/);
  });

  it('allows absolute paths within restriction', () => {
    assert.doesNotThrow(() => assertSafePath('/workspace/foo.txt', '/workspace'));
    assert.doesNotThrow(() => assertSafePath('/workspace/sub/dir/file.ts', '/workspace'));
  });

  it('blocks traversal that escapes via deep nesting', () => {
    assert.throws(
      () => assertSafePath('a/b/c/../../../../etc/passwd', '/workspace'),
      /Path traversal detected/
    );
  });
});
