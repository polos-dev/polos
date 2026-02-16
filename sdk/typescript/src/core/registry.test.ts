import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkflowRegistry,
  WorkflowNotFoundError,
  type WorkflowRegistry,
} from './registry.js';
import type { Workflow } from '../types/workflow.js';

function makeWorkflow(id: string): Workflow {
  return {
    id,
    config: { id },
    handler: async () => undefined,
  } as unknown as Workflow;
}

describe('createWorkflowRegistry', () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = createWorkflowRegistry();
  });

  it('registers and retrieves a workflow', () => {
    const wf = makeWorkflow('wf-1');
    registry.register(wf);
    const retrieved = registry.get('wf-1');
    assert.strictEqual(retrieved.id, 'wf-1');
  });

  it('has() returns true for registered workflows', () => {
    const wf = makeWorkflow('wf-1');
    registry.register(wf);
    assert.strictEqual(registry.has('wf-1'), true);
    assert.strictEqual(registry.has('wf-2'), false);
  });

  it('replaces silently on duplicate registration', () => {
    const wf1 = makeWorkflow('dup');
    const wf2 = makeWorkflow('dup');
    registry.register(wf1);
    registry.register(wf2);
    assert.strictEqual(registry.get('dup'), wf2);
    assert.strictEqual(registry.getAll().length, 1);
  });

  it('throws WorkflowNotFoundError for non-existent workflow', () => {
    assert.throws(
      () => registry.get('missing'),
      (err: unknown) => {
        assert.ok(err instanceof WorkflowNotFoundError);
        assert.strictEqual(err.workflowId, 'missing');
        return true;
      }
    );
  });

  it('getAll() returns all registered workflows', () => {
    registry.register(makeWorkflow('a'));
    registry.register(makeWorkflow('b'));
    registry.register(makeWorkflow('c'));
    const all = registry.getAll();
    assert.strictEqual(all.length, 3);
    const ids = all.map((w) => w.id).sort();
    assert.deepStrictEqual(ids, ['a', 'b', 'c']);
  });

  it('getIds() returns all workflow IDs', () => {
    registry.register(makeWorkflow('x'));
    registry.register(makeWorkflow('y'));
    const ids = registry.getIds().sort();
    assert.deepStrictEqual(ids, ['x', 'y']);
  });

  it('remove() deletes a workflow and returns true', () => {
    registry.register(makeWorkflow('rem'));
    assert.strictEqual(registry.remove('rem'), true);
    assert.strictEqual(registry.has('rem'), false);
  });

  it('remove() returns false for non-existent workflow', () => {
    assert.strictEqual(registry.remove('nope'), false);
  });

  it('clear() removes all workflows', () => {
    registry.register(makeWorkflow('a'));
    registry.register(makeWorkflow('b'));
    registry.clear();
    assert.strictEqual(registry.getAll().length, 0);
    assert.strictEqual(registry.has('a'), false);
  });
});
