/**
 * Run the coding agent with sandbox tools and stream activity.
 *
 * This script invokes the coding agent, streams text and tool-call events
 * in real time, then displays the final result.
 *
 * Run the worker first:
 *   npx tsx worker.ts
 *
 * Then run this client:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL    - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY    - API key for authentication (optional for local dev)
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PolosClient } from '@polos/sdk';
import type { ExecutionHandle } from '@polos/sdk';
import { codingAgent } from './agents.js';

// ── Event streaming ────────────────────────────────────────────────

/**
 * Stream agent activity (text deltas, tool calls) until the workflow completes.
 */
async function streamActivity(
  client: PolosClient,
  handle: ExecutionHandle,
): Promise<void> {
  for await (const event of client.events.streamWorkflow(handle.rootWorkflowId, handle.id)) {
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
  const projectId = process.env['POLOS_PROJECT_ID'];
  if (!projectId) {
    throw new Error(
      'POLOS_PROJECT_ID environment variable is required. ' +
        'Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). ' +
        'You can get this from the output printed by `polos-server start` or from the UI page at ' +
        "http://localhost:5173/projects/settings (the ID will be below the project name 'default')",
    );
  }

  const client = new PolosClient({
    projectId,
    apiUrl: process.env['POLOS_API_URL'] ?? 'http://localhost:8080',
    apiKey: process.env['POLOS_API_KEY'] ?? '',
  });

  const task =
    'Create a file called hello.js that prints "Hello from the sandbox!" and run it. ' +
    'Then create a second file called fibonacci.js that computes the first 10 Fibonacci numbers ' +
    'and prints them. Run that too.';

  const conversationId = randomUUID();

  console.log('Invoking coding agent...\n');
  const handle = await client.invoke(
    codingAgent.id, { input: task, conversationId, streaming: true }
  );
  console.log(`Execution ID: ${handle.id}`);
  console.log('Streaming agent activity...\n');

  await streamActivity(client, handle);

  // Fetch final result
  console.log('\n' + '-'.repeat(60));
  console.log('\nFetching final result...');

  await new Promise((r) => setTimeout(r, 2000));
  const execution = await client.getExecution(handle.id);

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
}

main().catch(console.error);
