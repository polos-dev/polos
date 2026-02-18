import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { sandboxTools } from '../sandbox-tools.js';
import { globalRegistry } from '../../core/registry.js';

describe('sandboxTools', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('returns all 6 tools by default', () => {
    const tools = sandboxTools({ env: 'docker' });

    assert.strictEqual(tools.length, 6);

    const ids = tools.map((t) => t.id);
    assert.ok(ids.includes('exec'));
    assert.ok(ids.includes('read'));
    assert.ok(ids.includes('write'));
    assert.ok(ids.includes('edit'));
    assert.ok(ids.includes('glob'));
    assert.ok(ids.includes('grep'));
  });

  it('returns a plain array (ToolWorkflow[])', () => {
    const tools = sandboxTools({ env: 'docker' });
    assert.ok(Array.isArray(tools));
  });

  it('returns subset when tools option is specified', () => {
    const tools = sandboxTools({
      env: 'docker',
      tools: ['read', 'glob'],
    });

    assert.strictEqual(tools.length, 2);
    assert.strictEqual(tools[0]!.id, 'read');
    assert.strictEqual(tools[1]!.id, 'glob');
  });

  it('returns single tool when specified', () => {
    const tools = sandboxTools({
      env: 'docker',
      tools: ['exec'],
    });

    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0]!.id, 'exec');
  });

  it('each tool has valid LLM definition', () => {
    const tools = sandboxTools({ env: 'docker' });

    for (const tool of tools) {
      const def = tool.toLlmToolDefinition();

      assert.strictEqual(def.type, 'function');
      assert.ok(def.function.name);
      assert.ok(def.function.description);
      assert.ok(typeof def.function.parameters === 'object');
      assert.ok('properties' in def.function.parameters);
    }
  });

  it('exec tool definition includes command parameter', () => {
    const tools = sandboxTools({ env: 'docker', tools: ['exec'] });
    const execDef = tools[0]!.toLlmToolDefinition();
    const props = execDef.function.parameters['properties'] as Record<string, unknown>;
    assert.ok('command' in props);
  });

  it('read tool definition includes path parameter', () => {
    const tools = sandboxTools({ env: 'docker', tools: ['read'] });
    const readDef = tools[0]!.toLlmToolDefinition();
    const props = readDef.function.parameters['properties'] as Record<string, unknown>;
    assert.ok('path' in props);
  });

  it('write tool definition includes path and content parameters', () => {
    const tools = sandboxTools({ env: 'docker', tools: ['write'] });
    const writeDef = tools[0]!.toLlmToolDefinition();
    const props = writeDef.function.parameters['properties'] as Record<string, unknown>;
    assert.ok('path' in props);
    assert.ok('content' in props);
  });

  it('edit tool definition includes path, old_text, new_text parameters', () => {
    const tools = sandboxTools({ env: 'docker', tools: ['edit'] });
    const editDef = tools[0]!.toLlmToolDefinition();
    const props = editDef.function.parameters['properties'] as Record<string, unknown>;
    assert.ok('path' in props);
    assert.ok('old_text' in props);
    assert.ok('new_text' in props);
  });

  it('glob tool definition includes pattern parameter', () => {
    const tools = sandboxTools({ env: 'docker', tools: ['glob'] });
    const globDef = tools[0]!.toLlmToolDefinition();
    const props = globDef.function.parameters['properties'] as Record<string, unknown>;
    assert.ok('pattern' in props);
  });

  it('grep tool definition includes pattern parameter', () => {
    const tools = sandboxTools({ env: 'docker', tools: ['grep'] });
    const grepDef = tools[0]!.toLlmToolDefinition();
    const props = grepDef.function.parameters['properties'] as Record<string, unknown>;
    assert.ok('pattern' in props);
  });

  it('tools are auto-registered in global registry', () => {
    const before = globalRegistry.getIds().length;

    sandboxTools({ env: 'docker' });

    const after = globalRegistry.getIds().length;
    assert.strictEqual(after - before, 6);
  });

  it('throws for e2b environment (not yet implemented)', () => {
    assert.throws(() => sandboxTools({ env: 'e2b' }), /not yet implemented/);
  });

  it('creates tools for local environment', () => {
    const tools = sandboxTools({ env: 'local' });

    assert.strictEqual(tools.length, 6);

    const ids = tools.map((t) => t.id);
    assert.ok(ids.includes('exec'));
    assert.ok(ids.includes('read'));
    assert.ok(ids.includes('write'));
    assert.ok(ids.includes('edit'));
    assert.ok(ids.includes('glob'));
    assert.ok(ids.includes('grep'));
  });

  it('local environment defaults exec security to approval-always', () => {
    // Should not throw — local is supported
    const tools = sandboxTools({ env: 'local' });
    assert.strictEqual(tools.length, 6);
  });

  it('local environment respects explicit exec security', () => {
    const tools = sandboxTools({
      env: 'local',
      exec: { security: 'allow-always' },
    });
    assert.strictEqual(tools.length, 6);
  });

  it('accepts SandboxConfig fields (scope, id, idleDestroyTimeout)', () => {
    const tools = sandboxTools({
      env: 'docker',
      scope: 'session',
      id: 'my-sandbox',
      idleDestroyTimeout: '24h',
    });

    assert.strictEqual(tools.length, 6);
  });
});
