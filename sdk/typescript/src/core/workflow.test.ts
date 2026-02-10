import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { defineWorkflow, validateCronGranularity } from './workflow.js';
import { globalRegistry } from './registry.js';

describe('validateCronGranularity', () => {
  it('accepts 5-field cron expressions', () => {
    assert.doesNotThrow(() => validateCronGranularity('0 8 * * *'));
    assert.doesNotThrow(() => validateCronGranularity('*/5 * * * *'));
    assert.doesNotThrow(() => validateCronGranularity('0 0 1 1 *'));
  });

  it('throws for 6+ field (second-granularity) cron expressions', () => {
    assert.throws(() => validateCronGranularity('0 0 8 * * *'), {
      message: /second-level granularity/,
    });
    assert.throws(() => validateCronGranularity('0 0 0 8 * * *'), {
      message: /second-level granularity/,
    });
  });
});

describe('defineWorkflow', () => {
  afterEach(() => {
    // Clean up global registry between tests
    globalRegistry.clear();
  });

  it('creates a workflow with correct id and config', () => {
    const wf = defineWorkflow(
      { id: 'test-wf', description: 'A test workflow' },
      async () => 'done'
    );

    assert.strictEqual(wf.id, 'test-wf');
    assert.strictEqual(wf.description, 'A test workflow');
    assert.strictEqual(wf.config.id, 'test-wf');
  });

  it('stores payloadSchema, stateSchema, outputSchema', () => {
    const payloadSchema = z.object({ name: z.string() });
    const stateSchema = z.object({ count: z.number().default(0) });
    const outputSchema = z.object({ result: z.string() });

    const wf = defineWorkflow(
      { id: 'schema-wf', payloadSchema, stateSchema, outputSchema },
      async () => ({ result: 'ok' })
    );

    assert.strictEqual(wf.payloadSchema, payloadSchema);
    assert.strictEqual(wf.stateSchema, stateSchema);
    assert.strictEqual(wf.outputSchema, outputSchema);
  });

  it('auto-registers in globalRegistry by default', () => {
    defineWorkflow({ id: 'auto-reg' }, async () => 'ok');
    assert.strictEqual(globalRegistry.has('auto-reg'), true);
  });

  it('skips auto-registration when autoRegister=false', () => {
    defineWorkflow({ id: 'no-reg' }, async () => 'ok', { autoRegister: false });
    assert.strictEqual(globalRegistry.has('no-reg'), false);
  });

  it('validates cron schedule string', () => {
    assert.throws(
      () => defineWorkflow({ id: 'bad-cron', schedule: '0 0 8 * * *' }, async () => 'ok'),
      { message: /second-level granularity/ }
    );
  });

  it('validates cron in ScheduleConfig object', () => {
    assert.throws(
      () =>
        defineWorkflow({ id: 'bad-cron-obj', schedule: { cron: '0 0 8 * * *' } }, async () => 'ok'),
      { message: /second-level granularity/ }
    );
  });

  it('skips cron validation when schedule is boolean true', () => {
    const wf = defineWorkflow({ id: 'bool-sched', schedule: true }, async () => 'ok', {
      autoRegister: false,
    });
    assert.strictEqual(wf.id, 'bool-sched');
  });

  it('accepts valid 5-field cron schedule', () => {
    const wf = defineWorkflow({ id: 'good-cron', schedule: '0 8 * * *' }, async () => 'ok', {
      autoRegister: false,
    });
    assert.strictEqual(wf.id, 'good-cron');
  });

  it('stores the handler function', () => {
    const handler = async () => 'result';
    const wf = defineWorkflow({ id: 'handler-wf' }, handler, { autoRegister: false });
    assert.strictEqual(wf.handler, handler);
  });
});
