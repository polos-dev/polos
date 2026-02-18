/**
 * Session Sandbox Example — reusing a sandbox across multiple agent runs.
 *
 * Demonstrates session-scoped sandboxes: two separate invoke() calls share
 * the same sessionId, so the second agent run can see files created by the
 * first. The Docker container persists between runs and is cleaned up
 * automatically when idle.
 *
 * Prerequisites:
 *   - Docker must be installed and running
 *   - Polos server running (polos-server start)
 *
 * Run:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID  - Your project ID (default from env)
 *   POLOS_API_URL     - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY     - API key for authentication (optional for local dev)
 *   POLOS_WORKSPACES_DIR - Base path for sandbox workspaces (default: /var/polos/workspaces)
 *   ANTHROPIC_API_KEY - Anthropic API key for the coding agent
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Polos } from '@polos/sdk';
import type { ExecutionHandle } from '@polos/sdk';

// Import for side-effects: triggers global registry registration
import './agents.js';

import { codingAgent } from './agents.js';

// ── Helpers ─────────────────────────────────────────────────────────

function printBanner(text: string): void {
  const line = '='.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

/**
 * Stream agent activity (text deltas, tool calls) until the workflow completes.
 */
async function streamActivity(
  polos: Polos,
  handle: ExecutionHandle,
): Promise<void> {
  for await (const event of polos.events.streamWorkflow(handle.rootWorkflowId, handle.id)) {
    const eventType = event.eventType;

    if (eventType === 'text_delta') {
      const content = (event.data as Record<string, unknown>)['content'];
      if (typeof content === 'string') {
        process.stdout.write(content);
      }
    } else if (eventType === 'tool_call') {
      const toolCall = (event.data as Record<string, unknown>)['tool_call'] as
        | Record<string, unknown>
        | undefined;
      const fn = toolCall?.['function'] as Record<string, unknown> | undefined;
      const toolName = fn?.['name'] ?? 'unknown';
      console.log(`\n  [Using ${String(toolName)}...]`);
    }
  }
}

/**
 * Invoke the agent, stream its output, and print the final result.
 */
async function runAgent(
  polos: Polos,
  task: string,
  sessionId: string,
  label: string,
): Promise<void> {
  printBanner(label);
  console.log(`\n  Task: ${task}\n`);
  console.log(`  Session ID: ${sessionId}\n`);
  console.log('-'.repeat(60));

  const handle = await polos.invoke(
    codingAgent.id,
    { input: task, streaming: true },
    { sessionId },
  );
  console.log(`\nExecution ID: ${handle.id}`);
  console.log('Streaming agent activity...\n');

  await streamActivity(polos, handle);

  // Fetch final result
  console.log('\n' + '-'.repeat(60));
  console.log('\nFetching final result...');

  await new Promise((r) => setTimeout(r, 2000));
  const execution = await polos.getExecution(handle.id);

  if (execution.status === 'completed') {
    const result = typeof execution.result === 'string'
      ? execution.result
      : JSON.stringify(execution.result, null, 2);
    console.log(`\n${result}\n`);
  } else {
    console.log(`\nFinal status: ${execution.status}`);
    if (execution.result) {
      console.log(execution.result);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const polos = new Polos({ deploymentId: 'session-sandbox-examples', logFile: 'polos.log' });
  await polos.start();

  // A single session ID shared across both agent runs.
  // This causes the SandboxManager to reuse the same Docker container,
  // so files and state persist between invocations.
  const sessionId = randomUUID();

  try {
    // ── Run 1: Create a utility module ──────────────────────────────
    await runAgent(
      polos,
      'Create a file called math-utils.js with two exported functions: ' +
        '`add(a, b)` and `multiply(a, b)`. ' +
        'Then create a test file called test-math.js that requires math-utils.js, ' +
        'runs a few assertions, and prints "All tests passed!" if they succeed. ' +
        'Run the test file with node.',
      sessionId,
      'Run 1: Create math-utils and test it',
    );

    // ── Run 2: Build on top of what Run 1 created ──────────────────
    await runAgent(
      polos,
      'List the files in /workspace to see what already exists. ' +
        'Then add a `subtract(a, b)` function to the existing math-utils.js file. ' +
        'Update test-math.js to also test subtract. ' +
        'Run the tests again with node.',
      sessionId,
      'Run 2: Extend math-utils (same sandbox)',
    );
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
