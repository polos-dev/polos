import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createAskUserTool } from '../ask-user.js';
import { globalRegistry } from '../../core/registry.js';

describe('createAskUserTool', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('creates a tool with correct id', () => {
    const tool = createAskUserTool();
    assert.strictEqual(tool.id, 'ask_user');
  });

  it('creates a tool with a description', () => {
    const tool = createAskUserTool();
    assert.ok(tool.toolDescription);
    assert.ok(tool.toolDescription.includes('Ask the user'));
  });

  it('has valid LLM tool definition', () => {
    const tool = createAskUserTool();
    const def = tool.toLlmToolDefinition();

    assert.strictEqual(def.type, 'function');
    assert.strictEqual(def.function.name, 'ask_user');
    assert.ok(def.function.description);
    assert.ok(typeof def.function.parameters === 'object');
    assert.ok('properties' in def.function.parameters);
  });

  it('input schema requires question parameter', () => {
    const tool = createAskUserTool();
    const def = tool.toLlmToolDefinition();
    const props = def.function.parameters['properties'] as Record<string, unknown>;

    assert.ok('question' in props);
  });

  it('input schema includes optional title parameter', () => {
    const tool = createAskUserTool();
    const def = tool.toLlmToolDefinition();
    const props = def.function.parameters['properties'] as Record<string, unknown>;

    assert.ok('title' in props);
  });

  it('input schema includes optional fields parameter', () => {
    const tool = createAskUserTool();
    const def = tool.toLlmToolDefinition();
    const props = def.function.parameters['properties'] as Record<string, unknown>;

    assert.ok('fields' in props);
  });

  it('question is in the required list', () => {
    const tool = createAskUserTool();
    const def = tool.toLlmToolDefinition();
    const required = def.function.parameters['required'] as string[];

    assert.ok(required.includes('question'));
  });

  it('fields and title are not in the required list', () => {
    const tool = createAskUserTool();
    const def = tool.toLlmToolDefinition();
    const required = def.function.parameters['required'] as string[] | undefined;

    if (required) {
      assert.ok(!required.includes('fields'));
      assert.ok(!required.includes('title'));
    }
  });

  it('is auto-registered in the global registry', () => {
    const before = globalRegistry.getIds().length;
    createAskUserTool();
    const after = globalRegistry.getIds().length;

    assert.strictEqual(after - before, 1);
  });
});
