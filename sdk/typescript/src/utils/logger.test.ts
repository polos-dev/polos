import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLogger, type LogEntry } from './logger.js';

describe('createLogger', () => {
  it('emits log entries at correct levels', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ level: 'debug', handler: (e) => entries.push(e) });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0]?.level, 'debug');
    assert.strictEqual(entries[1]?.level, 'info');
    assert.strictEqual(entries[2]?.level, 'warn');
    assert.strictEqual(entries[3]?.level, 'error');
  });

  it('filters by level — debug not emitted when level=info', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ level: 'info', handler: (e) => entries.push(e) });

    logger.debug('should not appear');
    logger.info('should appear');

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.level, 'info');
  });

  it('filters by level — only error when level=error', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ level: 'error', handler: (e) => entries.push(e) });

    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('yes');

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.level, 'error');
  });

  it('includes context in log entries', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ level: 'debug', handler: (e) => entries.push(e) });

    logger.info('test', { key: 'value', count: 42 });

    assert.strictEqual(entries.length, 1);
    assert.deepStrictEqual(entries[0]?.context, { key: 'value', count: 42 });
  });

  it('prefixes message with name', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ name: 'myLogger', handler: (e) => entries.push(e) });

    logger.info('hello');

    assert.strictEqual(entries[0]?.message, '[myLogger] hello');
  });

  it('includes timestamp in entries', () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ handler: (e) => entries.push(e) });

    logger.info('test');

    assert.ok(entries[0]?.timestamp);
    // Should be a valid ISO string
    assert.ok(!isNaN(new Date(entries[0]!.timestamp).getTime()));
  });
});

describe('child logger', () => {
  it('inherits parent name', () => {
    const entries: LogEntry[] = [];
    const parent = createLogger({ name: 'parent', handler: (e) => entries.push(e) });
    const child = parent.child({ name: 'child' });

    child.info('hello');

    assert.strictEqual(entries[0]?.message, '[parent:child] hello');
  });

  it('inherits parent level and handler', () => {
    const entries: LogEntry[] = [];
    const parent = createLogger({ level: 'warn', handler: (e) => entries.push(e) });
    const child = parent.child({});

    child.info('should not appear');
    child.warn('should appear');

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.level, 'warn');
  });

  it('can override parent level', () => {
    const entries: LogEntry[] = [];
    const parent = createLogger({ level: 'error', handler: (e) => entries.push(e) });
    const child = parent.child({ level: 'debug' });

    child.debug('should appear');

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.level, 'debug');
  });

  it('uses child name when parent has no name', () => {
    const entries: LogEntry[] = [];
    const parent = createLogger({ handler: (e) => entries.push(e) });
    const child = parent.child({ name: 'child' });

    child.info('hello');

    assert.strictEqual(entries[0]?.message, '[child] hello');
  });
});
