/**
 * Example lifecycle hooks for agents.
 *
 * Hooks are functions that execute at specific points in the agent lifecycle:
 * - onStart: Before agent execution begins
 * - onEnd: After agent execution completes
 * - onAgentStepStart: Before each LLM call
 * - onAgentStepEnd: After each LLM call
 * - onToolStart: Before tool execution
 * - onToolEnd: After tool execution
 */

import { defineHook, HookResult } from '@polos/sdk';
import type { HookResultType } from '@polos/sdk';

// Track execution metrics (in-memory, for demo purposes)
const executionMetrics: Record<
  string,
  { startTime: number; stepCount: number; toolCalls: string[] }
> = {};

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Log when agent execution starts.
 */
export const logStart = defineHook(
  async (ctx, _hookCtx): Promise<HookResultType> => {
    const workflowId = ctx.workflowId;
    executionMetrics[workflowId] = {
      startTime: Date.now(),
      stepCount: 0,
      toolCalls: [],
    };
    console.log(`\n[${timestamp()}] Agent started - workflow: ${workflowId}`);
    return HookResult.continue();
  },
  { name: 'log_start' },
);

/**
 * Log when agent execution ends.
 */
export const logEnd = defineHook(
  async (ctx, _hookCtx): Promise<HookResultType> => {
    const workflowId = ctx.workflowId;
    const metrics = executionMetrics[workflowId];
    const duration = metrics
      ? ((Date.now() - metrics.startTime) / 1000).toFixed(2)
      : '?';
    const stepCount = metrics?.stepCount ?? 0;
    const toolCalls = metrics?.toolCalls ?? [];

    console.log(`\n[${timestamp()}] Agent completed`);
    console.log(`  Duration: ${duration}s`);
    console.log(`  Steps: ${stepCount}`);
    console.log(`  Tools used: [${toolCalls.join(', ')}]`);

    return HookResult.continue();
  },
  { name: 'log_end' },
);

/**
 * Log when an LLM step starts.
 */
export const logStepStart = defineHook(
  async (ctx, _hookCtx): Promise<HookResultType> => {
    const workflowId = ctx.workflowId;
    const metrics = executionMetrics[workflowId];
    if (metrics) {
      metrics.stepCount += 1;
      console.log(`\n  [Step ${String(metrics.stepCount)}] LLM call starting...`);
    }

    return HookResult.continue();
  },
  { name: 'log_step_start' },
);

/**
 * Log when an LLM step ends.
 */
export const logStepEnd = defineHook(
  async (_ctx, _hookCtx): Promise<HookResultType> => {
    console.log('  [Step] LLM call completed');
    return HookResult.continue();
  },
  { name: 'log_step_end' },
);

/**
 * Log when a tool execution starts.
 */
export const logToolStart = defineHook(
  async (_ctx, hookCtx): Promise<HookResultType> => {
    const payload = hookCtx.currentPayload as Record<string, unknown> | undefined;
    console.log(`    [Tool] Executing with payload: ${JSON.stringify(payload)}`);
    return HookResult.continue();
  },
  { name: 'log_tool_start' },
);

/**
 * Log when a tool execution ends.
 */
export const logToolEnd = defineHook(
  async (ctx, hookCtx): Promise<HookResultType> => {
    const workflowId = ctx.workflowId;
    const metrics = executionMetrics[workflowId];
    if (metrics) {
      metrics.toolCalls.push('tool');
    }

    const output = hookCtx.currentOutput;
    console.log(`    [Tool] Completed with output: ${JSON.stringify(output)}`);
    return HookResult.continue();
  },
  { name: 'log_tool_end' },
);

/**
 * Validate input before agent execution starts.
 */
export const validateInput = defineHook(
  async (_ctx, hookCtx): Promise<HookResultType> => {
    // Access the input payload
    const payload = hookCtx.currentPayload as Record<string, unknown> | undefined;
    const input =
      typeof payload === 'object' && payload !== null
        ? String(payload['input'] ?? '')
        : '';

    // Reject empty inputs
    if (!input || !input.trim()) {
      return HookResult.fail('Empty input not allowed');
    }

    // Reject very long inputs
    if (input.length > 10000) {
      return HookResult.fail('Input too long (max 10000 characters)');
    }

    return HookResult.continue();
  },
  { name: 'validate_input' },
);

/**
 * Modify tool payload before execution.
 * Example: Add default values or sanitize inputs.
 */
export const modifyToolPayload = defineHook(
  async (_ctx, hookCtx): Promise<HookResultType> => {
    const payload = (hookCtx.currentPayload ?? {}) as Record<string, unknown>;

    // Add timestamp to all tool calls
    const modified = { ...payload, timestamp: new Date().toISOString() };

    return HookResult.continueWith({ modifiedPayload: modified });
  },
  { name: 'modify_tool_payload' },
);

/**
 * Enrich tool output after execution.
 * Example: Add metadata to tool results.
 */
export const enrichToolOutput = defineHook(
  async (_ctx, hookCtx): Promise<HookResultType> => {
    const output = (hookCtx.currentOutput ?? {}) as Record<string, unknown>;

    // Add source information to output
    const modified = {
      ...output,
      _meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return HookResult.continueWith({ modifiedOutput: modified });
  },
  { name: 'enrich_tool_output' },
);
