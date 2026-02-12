import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { truncateOutput, isBinary, parseGrepOutput, stripAnsi } from '../output.js';

describe('truncateOutput', () => {
  it('returns original text when under limit', () => {
    const result = truncateOutput('hello world', 100);
    assert.strictEqual(result.text, 'hello world');
    assert.strictEqual(result.truncated, false);
  });

  it('returns original text when exactly at limit', () => {
    const text = 'a'.repeat(100);
    const result = truncateOutput(text, 100);
    assert.strictEqual(result.text, text);
    assert.strictEqual(result.truncated, false);
  });

  it('truncates text exceeding the limit', () => {
    const text = 'a'.repeat(200);
    const result = truncateOutput(text, 100);
    assert.strictEqual(result.truncated, true);
    assert.ok(result.text.includes('--- truncated'));
    assert.ok(result.text.includes('100 characters'));
  });

  it('preserves head and tail portions', () => {
    // Create text where we can verify head/tail content
    const head = 'H'.repeat(20);
    const middle = 'M'.repeat(60);
    const tail = 'T'.repeat(20);
    const text = head + middle + tail; // 100 chars
    const result = truncateOutput(text, 50);
    assert.strictEqual(result.truncated, true);
    // Head = 50 * 0.2 = 10 chars, Tail = 40 chars
    assert.ok(result.text.startsWith('H'.repeat(10)));
    assert.ok(result.text.endsWith('T'.repeat(20)));
  });

  it('uses default max when not specified', () => {
    const text = 'a'.repeat(99_999);
    const result = truncateOutput(text);
    assert.strictEqual(result.truncated, false);

    const longText = 'a'.repeat(100_001);
    const result2 = truncateOutput(longText);
    assert.strictEqual(result2.truncated, true);
  });
});

describe('isBinary', () => {
  it('returns false for plain text', () => {
    const buffer = Buffer.from('Hello, world!\nThis is a text file.\n');
    assert.strictEqual(isBinary(buffer), false);
  });

  it('returns true for buffer with null bytes', () => {
    const buffer = Buffer.from([72, 101, 108, 0, 108, 111]);
    assert.strictEqual(isBinary(buffer), true);
  });

  it('returns false for empty buffer', () => {
    const buffer = Buffer.alloc(0);
    assert.strictEqual(isBinary(buffer), false);
  });

  it('only checks first 8KB', () => {
    // Create a buffer with null byte past 8KB
    const buffer = Buffer.alloc(16384, 65); // Fill with 'A'
    buffer[10000] = 0; // Null byte after 8KB
    assert.strictEqual(isBinary(buffer), false);
  });

  it('detects null byte within first 8KB', () => {
    const buffer = Buffer.alloc(16384, 65);
    buffer[4000] = 0; // Null byte within first 8KB
    assert.strictEqual(isBinary(buffer), true);
  });
});

describe('parseGrepOutput', () => {
  it('parses standard grep -rn output', () => {
    const output = 'src/main.ts:10:const foo = "bar";\nsrc/utils.ts:25:function helper() {';
    const matches = parseGrepOutput(output);

    assert.strictEqual(matches.length, 2);

    assert.strictEqual(matches[0]!.path, 'src/main.ts');
    assert.strictEqual(matches[0]!.line, 10);
    assert.strictEqual(matches[0]!.text, 'const foo = "bar";');

    assert.strictEqual(matches[1]!.path, 'src/utils.ts');
    assert.strictEqual(matches[1]!.line, 25);
    assert.strictEqual(matches[1]!.text, 'function helper() {');
  });

  it('returns empty array for empty output', () => {
    assert.deepStrictEqual(parseGrepOutput(''), []);
    assert.deepStrictEqual(parseGrepOutput('  \n  '), []);
  });

  it('handles paths with colons', () => {
    const output = '/home/user/project/file.ts:5:let x = 1;';
    const matches = parseGrepOutput(output);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0]!.path, '/home/user/project/file.ts');
    assert.strictEqual(matches[0]!.line, 5);
    assert.strictEqual(matches[0]!.text, 'let x = 1;');
  });

  it('handles lines with colons in the matched text', () => {
    const output = 'config.ts:3:const url = "http://localhost:3000";';
    const matches = parseGrepOutput(output);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0]!.text, 'const url = "http://localhost:3000";');
  });

  it('skips malformed lines', () => {
    const output = 'valid.ts:1:match\nnot a match\nalso-valid.ts:2:another';
    const matches = parseGrepOutput(output);
    assert.strictEqual(matches.length, 2);
  });
});

describe('stripAnsi', () => {
  it('removes ANSI color codes', () => {
    const text = '\x1b[31mRed text\x1b[0m and \x1b[32mgreen text\x1b[0m';
    assert.strictEqual(stripAnsi(text), 'Red text and green text');
  });

  it('returns plain text unchanged', () => {
    const text = 'Just plain text';
    assert.strictEqual(stripAnsi(text), text);
  });

  it('handles bold and underline codes', () => {
    const text = '\x1b[1mBold\x1b[0m \x1b[4mUnderline\x1b[0m';
    assert.strictEqual(stripAnsi(text), 'Bold Underline');
  });

  it('handles empty string', () => {
    assert.strictEqual(stripAnsi(''), '');
  });
});
