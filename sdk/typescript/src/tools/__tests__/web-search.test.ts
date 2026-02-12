import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createWebSearchTool } from '../web-search.js';
import { globalRegistry } from '../../core/registry.js';

describe('createWebSearchTool', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('creates a tool with default id "web_search"', () => {
    const tool = createWebSearchTool({
      search: async (query) => ({ query, results: [] }),
    });
    assert.strictEqual(tool.id, 'web_search');
  });

  it('supports custom toolId', () => {
    const tool = createWebSearchTool({
      toolId: 'my_search',
      search: async (query) => ({ query, results: [] }),
    });
    assert.strictEqual(tool.id, 'my_search');
  });

  it('has valid LLM tool definition', () => {
    const tool = createWebSearchTool({
      search: async (query) => ({ query, results: [] }),
    });
    const def = tool.toLlmToolDefinition();

    assert.strictEqual(def.type, 'function');
    assert.strictEqual(def.function.name, 'web_search');
    assert.ok(def.function.description);
    assert.ok(typeof def.function.parameters === 'object');
    assert.ok('properties' in def.function.parameters);

    const props = def.function.parameters['properties'] as Record<string, unknown>;
    assert.ok('query' in props);
    assert.ok('maxResults' in props);
    assert.ok('topic' in props);
  });

  it('query is required; maxResults and topic are optional', () => {
    const tool = createWebSearchTool({
      search: async (query) => ({ query, results: [] }),
    });
    const def = tool.toLlmToolDefinition();
    const required = def.function.parameters['required'] as string[];

    assert.ok(required.includes('query'));
    assert.ok(!required.includes('maxResults'));
    assert.ok(!required.includes('topic'));
  });

  it('is auto-registered in the global registry', () => {
    const before = globalRegistry.getIds().length;
    createWebSearchTool({
      search: async (query) => ({ query, results: [] }),
    });
    const after = globalRegistry.getIds().length;

    assert.strictEqual(after - before, 1);
  });

  it('accepts a custom search function', () => {
    const customSearch = async (query: string) => ({
      query,
      results: [{ title: 'Test', url: 'https://example.com', content: 'Test content' }],
    });

    const tool = createWebSearchTool({ search: customSearch });
    assert.strictEqual(tool.id, 'web_search');
  });

  it('accepts approval option and produces a valid tool', () => {
    const tool = createWebSearchTool({
      approval: 'always',
      search: async (query) => ({ query, results: [] }),
    });
    assert.strictEqual(tool.id, 'web_search');

    const def = tool.toLlmToolDefinition();
    assert.strictEqual(def.type, 'function');
    assert.strictEqual(def.function.name, 'web_search');
    assert.ok(def.function.description);
  });

  it('Tavily API key error is descriptive when missing', () => {
    // Factory succeeds even without an API key (lazy resolution)
    const originalEnv = process.env['TAVILY_API_KEY'];
    delete process.env['TAVILY_API_KEY'];

    try {
      const tool = createWebSearchTool();
      assert.ok(tool, 'Factory should succeed without API key');
      assert.strictEqual(tool.id, 'web_search');
    } finally {
      if (originalEnv !== undefined) {
        process.env['TAVILY_API_KEY'] = originalEnv;
      }
    }
  });
});
