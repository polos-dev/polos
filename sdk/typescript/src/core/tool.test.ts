import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { defineTool, isToolWorkflow } from './tool.js';
import { globalRegistry } from './registry.js';

describe('defineTool', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('creates a tool with workflowType "tool"', () => {
    const tool = defineTool({ id: 'my-tool', description: 'A test tool' }, async () => 'result');

    assert.strictEqual(tool.id, 'my-tool');
    assert.strictEqual(tool.config.workflowType, 'tool');
    assert.strictEqual(tool.toolDescription, 'A test tool');
  });

  it('toLlmToolDefinition() returns OpenAI-compatible format', () => {
    const tool = defineTool(
      {
        id: 'search',
        description: 'Search the knowledge base',
        inputSchema: z.object({
          query: z.string(),
          limit: z.number().optional(),
        }),
      },
      async () => ({ results: [] })
    );

    const def = tool.toLlmToolDefinition();

    assert.strictEqual(def.type, 'function');
    assert.strictEqual(def.function.name, 'search');
    assert.strictEqual(def.function.description, 'Search the knowledge base');
    assert.ok(typeof def.function.parameters === 'object');
    assert.ok('properties' in def.function.parameters);
  });

  it('produces empty parameters when no input schema', () => {
    const tool = defineTool({ id: 'no-input', description: 'No input tool' }, async () => 'done');

    const def = tool.toLlmToolDefinition();
    assert.deepStrictEqual(def.function.parameters, { type: 'object', properties: {} });
  });

  it('converts input schema to JSON schema in toolParameters', () => {
    const tool = defineTool(
      {
        id: 'typed-tool',
        description: 'Typed tool',
        inputSchema: z.object({ name: z.string() }),
      },
      async () => 'ok'
    );

    assert.ok(typeof tool.toolParameters === 'object');
    assert.ok('properties' in tool.toolParameters);
    const props = tool.toolParameters['properties'] as Record<string, unknown>;
    assert.ok('name' in props);
  });

  it('getToolType() returns "default"', () => {
    const tool = defineTool({ id: 't1', description: 'd' }, async () => 'ok');
    assert.strictEqual(tool.getToolType(), 'default');
  });

  it('getToolMetadata() returns undefined', () => {
    const tool = defineTool({ id: 't2', description: 'd' }, async () => 'ok');
    assert.strictEqual(tool.getToolMetadata(), undefined);
  });
});

describe('isToolWorkflow', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('returns true for tool workflows', () => {
    const tool = defineTool({ id: 'tool-guard', description: 'test' }, async () => 'ok');
    assert.strictEqual(isToolWorkflow(tool), true);
  });

  it('returns false for non-tool workflows', async () => {
    const { defineWorkflow } = await import('./workflow.js');
    const wf = defineWorkflow({ id: 'plain-wf' }, async () => 'ok', { autoRegister: false });
    assert.strictEqual(isToolWorkflow(wf), false);
  });
});
