/**
 * Sandbox Tools Example — unified single-file usage.
 *
 * Starts a Polos instance (worker + client), invokes the coding agent
 * with sandbox tools, streams text and tool-call events in real time,
 * then displays the final result.
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
 *   ANTHROPIC_API_KEY - Anthropic API key for the coding agent
 */

import 'dotenv/config';
import { Polos } from '@polos/sdk';
import type { ExecutionHandle } from '@polos/sdk';

// Import for side-effects: triggers global registry registration
import './agents.js';

import { codingAgent } from './agents.js';

// ── Event streaming ────────────────────────────────────────────────

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

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const polos = new Polos({ deploymentId: 'sandbox-tools-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    const task =
      'Create a file called hello.js that prints "Hello from the sandbox!" and run it. ' +
      'Then create a second file called fibonacci.js that computes the first 10 Fibonacci numbers ' +
      'and prints them. Run that too.';

    console.log('Invoking coding agent...\n');
    const handle = await polos.invoke(
      codingAgent.id, { input: task, streaming: true }
    );
    console.log(`Execution ID: ${handle.id}`);
    console.log('Streaming agent activity...\n');

    await streamActivity(polos, handle);

    // Fetch final result
    console.log('\n' + '-'.repeat(60));
    console.log('\nFetching final result...');

    await new Promise((r) => setTimeout(r, 2000));
    const execution = await polos.getExecution(handle.id);

    if (execution.status === 'completed') {
      const line = '='.repeat(60);
      console.log(`\n${line}`);
      console.log('  Agent Completed');
      console.log(line);
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
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
