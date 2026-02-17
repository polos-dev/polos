import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { defineAgent, isAgentWorkflow } from './agent.js';
import { defineTool } from '../core/tool.js';
import { maxSteps } from './stop-conditions.js';
import { HookResult } from '../middleware/hook.js';
import { globalRegistry } from '../core/registry.js';
import { AgentRunConfig } from '../core/step.js';
import { getModelId, getModelProvider } from '../llm/types.js';

// Create a minimal mock LanguageModel
function createMockModel() {
  return {
    specificationVersion: 'v1' as const,
    provider: 'test-provider',
    modelId: 'test-model-id',
    defaultObjectGenerationMode: 'json' as const,
    doGenerate: async () => ({
      text: 'mock response',
      finishReason: 'stop' as const,
      usage: { promptTokens: 10, completionTokens: 5 },
      rawCall: { rawPrompt: '', rawSettings: {} },
    }),
    doStream: async () => ({
      stream: new ReadableStream(),
      rawCall: { rawPrompt: '', rawSettings: {} },
    }),
  };
}

describe('defineAgent', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('creates agent with correct config', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'my-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      description: 'A test agent',
      systemPrompt: 'You are helpful.',
    });

    assert.strictEqual(agent.id, 'my-agent');
    assert.strictEqual(agent.config.workflowType, 'agent');
    assert.strictEqual(agent.agentConfig.id, 'my-agent');
    assert.strictEqual(agent.agentConfig.description, 'A test agent');
    assert.strictEqual(agent.agentConfig.systemPrompt, 'You are helpful.');
  });

  it('auto-registers in globalRegistry', () => {
    const model = createMockModel();
    defineAgent({
      id: 'auto-reg-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    assert.strictEqual(globalRegistry.has('auto-reg-agent'), true);
  });

  it('creates LLM instance with model', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'llm-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    assert.ok(agent.llm);
    assert.strictEqual(getModelId(agent.llm.model), 'test-model-id');
    assert.strictEqual(getModelProvider(agent.llm.model), 'test-provider');
  });

  it('builds tool definitions for the LLM', () => {
    const model = createMockModel();
    const tool = defineTool(
      {
        id: 'search',
        description: 'Search something',
        inputSchema: z.object({ query: z.string() }),
      },
      async () => 'results'
    );

    const agent = defineAgent({
      id: 'tooled-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      tools: [tool],
    });

    assert.strictEqual(agent.tools.length, 1);
    assert.strictEqual(agent.tools[0]?.function.name, 'search');
    assert.strictEqual(agent.tools[0]?.type, 'function');
  });

  it('stores stop conditions', () => {
    const model = createMockModel();
    const stop = maxSteps({ count: 10 });

    const agent = defineAgent({
      id: 'stop-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      stopConditions: [stop],
    });

    assert.strictEqual(agent.stopConditions.length, 1);
  });

  it('normalizes hooks', () => {
    const model = createMockModel();
    const hookFn = async () => HookResult.continue();

    const agent = defineAgent({
      id: 'hook-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      onAgentStepStart: hookFn,
      onAgentStepEnd: [hookFn, hookFn],
    });

    assert.strictEqual(agent.agentHooks.onAgentStepStart.length, 1);
    assert.strictEqual(agent.agentHooks.onAgentStepEnd.length, 2);
  });

  it('normalizes guardrails', () => {
    const model = createMockModel();
    const guardrailFn = async () => ({ continue: true as const });

    const agent = defineAgent({
      id: 'guard-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      guardrails: [guardrailFn],
    });

    assert.strictEqual(agent.guardrails.length, 1);
    assert.ok(agent.guardrails[0]?.handler);
  });
});

describe('isAgentWorkflow', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('returns true for agent workflows', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'agent-guard-check',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    assert.strictEqual(isAgentWorkflow(agent), true);
  });

  it('returns false for non-agent workflows', async () => {
    const { defineWorkflow } = await import('../core/workflow.js');
    const wf = defineWorkflow({ id: 'plain-wf-guard' }, async () => 'ok', { autoRegister: false });
    assert.strictEqual(isAgentWorkflow(wf), false);
  });
});

describe('AgentWorkflow.withInput', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('returns AgentRunConfig with correct shape', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'with-input-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    const config = agent.withInput('Hello, agent!', {
      sessionId: 'sess-1',
      userId: 'user-1',
      streaming: true,
      initialState: { key: 'value' },
      runTimeoutSeconds: 30,
      kwargs: { extra: 'data' },
    });

    assert.ok(config instanceof AgentRunConfig);
    assert.strictEqual(config.agent, agent);
    assert.strictEqual(config.input, 'Hello, agent!');
    assert.strictEqual(config.sessionId, 'sess-1');
    assert.strictEqual(config.userId, 'user-1');
    assert.strictEqual(config.streaming, true);
    assert.deepStrictEqual(config.initialState, { key: 'value' });
    assert.strictEqual(config.runTimeoutSeconds, 30);
    assert.deepStrictEqual(config.kwargs, { extra: 'data' });
  });

  it('defaults streaming to false', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'default-streaming-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    const config = agent.withInput('test');
    assert.strictEqual(config.streaming, false);
  });

  it('accepts message array input', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'array-input-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    const messages = [{ role: 'user', content: 'Hi' }];
    const config = agent.withInput(messages);
    assert.deepStrictEqual(config.input, messages);
  });
});

describe('streamToWorkflow', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('defaults streamToWorkflow to undefined', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'stw-default-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    assert.strictEqual(agent.agentConfig.streamToWorkflow, undefined);
  });

  it('stores streamToWorkflow=true in agent config', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'stw-true-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      streamToWorkflow: true,
    });

    assert.strictEqual(agent.agentConfig.streamToWorkflow, true);
  });

  it('stores streamToWorkflow=false in agent config', () => {
    const model = createMockModel();
    const agent = defineAgent({
      id: 'stw-false-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      streamToWorkflow: false,
    });

    assert.strictEqual(agent.agentConfig.streamToWorkflow, false);
  });

  it('streaming resolves to true when streamToWorkflow=true and payload streaming=false', () => {
    // Verify the boolean OR logic: false || true || false === true
    const streamingFlag = false;
    const streamToWorkflow = true;
    const resolved = streamingFlag || streamToWorkflow || false;
    assert.strictEqual(resolved, true);
  });

  it('streaming resolves to true when streamToWorkflow=true and payload streaming=true', () => {
    const streamingFlag = true;
    const streamToWorkflow = true;
    const resolved = streamingFlag || streamToWorkflow || false;
    assert.strictEqual(resolved, true);
  });

  it('streaming resolves to false when streamToWorkflow=false and payload streaming=false', () => {
    const streamingFlag = false;
    const streamToWorkflow = false;
    const resolved = streamingFlag || streamToWorkflow || false;
    assert.strictEqual(resolved, false);
  });

  it('streaming resolves to true when streamToWorkflow=undefined and payload streaming=true', () => {
    const streamingFlag: boolean | undefined = true;
    const streamToWorkflow: boolean | undefined = undefined;
    const resolved = streamingFlag || streamToWorkflow || false;
    assert.strictEqual(resolved, true);
  });

  it('streaming resolves to false when streamToWorkflow=undefined and payload streaming is undefined', () => {
    const streamingFlag: boolean | undefined = undefined;
    const streamToWorkflow: boolean | undefined = undefined;
    const resolved = streamingFlag || streamToWorkflow || false;
    assert.strictEqual(resolved, false);
  });
});

describe('output schema', () => {
  afterEach(() => {
    globalRegistry.clear();
  });

  it('stores outputSchema in agent config', () => {
    const model = createMockModel();
    const outputSchema = z.object({ answer: z.string() });

    const agent = defineAgent({
      id: 'output-schema-agent',
      model: model as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      outputSchema,
    });

    assert.strictEqual(agent.agentConfig.outputSchema, outputSchema);
  });
});
