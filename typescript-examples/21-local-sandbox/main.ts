/**
 * Run the local sandbox coding agent with tool approval.
 *
 * Since local mode has no container isolation, destructive operations
 * (exec, write, edit) suspend for user approval before running.
 * This script handles those suspend events in the terminal.
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
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { PolosClient } from '@polos/sdk';
import type { ExecutionHandle } from '@polos/sdk';
import { codingAgent } from './agents.js';
import { randomUUID } from 'node:crypto';

const rl = readline.createInterface({ input, output });

// ── Helpers ─────────────────────────────────────────────────────────

function printBanner(text: string): void {
  const line = '='.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

async function ask(prompt: string): Promise<string> {
  return (await rl.question(prompt)).trim();
}

async function askYesNo(prompt: string): Promise<boolean> {
  while (true) {
    const answer = (await rl.question(`${prompt} (y/n): `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    console.log("  Please enter 'y' or 'n'");
  }
}

// ── Event handling ──────────────────────────────────────────────────

interface SuspendEvent {
  stepKey: string;
  data: Record<string, unknown>;
}

/**
 * Yield suspend events from the workflow stream.
 *
 * Uses a single persistent stream so that concurrent suspend events
 * (e.g., from batched tool calls) are never missed. Closing and
 * reopening the stream would lose events emitted between calls.
 *
 * Also streams text_delta and tool_call events to show agent activity
 * in real time between approval prompts.
 */
async function* suspendEvents(
  client: PolosClient,
  handle: ExecutionHandle,
): AsyncGenerator<SuspendEvent> {
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
    } else if (eventType?.startsWith('suspend_')) {
      const stepKey = eventType.slice('suspend_'.length);
      yield { stepKey, data: event.data as Record<string, unknown> };
    }
  }
}

// ── Exec approval UI ────────────────────────────────────────────────

/**
 * Show a command approval prompt (exec tool has its own suspend format).
 */
async function handleExecApproval(
  client: PolosClient,
  handle: ExecutionHandle,
  suspend: SuspendEvent,
): Promise<void> {
  const form = suspend.data['_form'] as Record<string, unknown> | undefined;
  const context = (form?.['context'] ?? {}) as Record<string, unknown>;
  const command = String(context['command'] ?? 'unknown');
  const cwd = String(context['cwd'] ?? '');

  printBanner('COMMAND APPROVAL REQUIRED');
  console.log('\n  The agent wants to run a command on your machine:\n');
  console.log(`    Command:   ${command}`);
  if (cwd) console.log(`    Directory: ${cwd}`);
  console.log();

  const approved = await askYesNo('  Approve this command?');

  let feedback: string | undefined;
  if (!approved) {
    const response = await ask('  Feedback (tell the agent what to do instead): ');
    if (response) feedback = response;
  }

  const resumeData: Record<string, unknown> = { approved, allow_always: false };
  if (feedback) resumeData['feedback'] = feedback;

  console.log(approved
    ? '\n  -> Approved. Resuming...\n'
    : `\n  -> Rejected${feedback ? ' with feedback' : ''}. Resuming...\n`);

  await client.resume(handle.rootWorkflowId, handle.id, suspend.stepKey, resumeData);
}

// ── File tool approval UI ───────────────────────────────────────────

/**
 * Show an approval prompt for write/edit tools (defineTool approval format).
 */
async function handleFileApproval(
  client: PolosClient,
  handle: ExecutionHandle,
  suspend: SuspendEvent,
): Promise<void> {
  const form = suspend.data['_form'] as Record<string, unknown> | undefined;
  const context = (form?.['context'] ?? {}) as Record<string, unknown>;
  const toolName = String(context['tool'] ?? 'unknown');
  const toolInput = context['input'] as Record<string, unknown> | undefined;

  printBanner(`${toolName.toUpperCase()} APPROVAL REQUIRED`);
  console.log(`\n  The agent wants to use the "${toolName}" tool:\n`);

  if (toolInput) {
    if (toolInput['path']) console.log(`    Path: ${String(toolInput['path'])}`);
    if (toolName === 'write' && toolInput['content']) {
      const content = String(toolInput['content']);
      const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
      console.log(`    Content:\n${preview.split('\n').map((l) => `      ${l}`).join('\n')}`);
    }
    if (toolName === 'edit') {
      if (toolInput['old_text']) console.log(`    Old text: ${String(toolInput['old_text'])}`);
      if (toolInput['new_text']) console.log(`    New text: ${String(toolInput['new_text'])}`);
    }
  }
  console.log();

  const approved = await askYesNo('  Approve this operation?');

  let feedback: string | undefined;
  if (!approved) {
    const response = await ask('  Feedback (tell the agent what to do instead): ');
    if (response) feedback = response;
  }

  const resumeData: Record<string, unknown> = { approved };
  if (feedback) resumeData['feedback'] = feedback;

  console.log(approved
    ? '\n  -> Approved. Resuming...\n'
    : `\n  -> Rejected${feedback ? ' with feedback' : ''}. Resuming...\n`);

  await client.resume(handle.rootWorkflowId, handle.id, suspend.stepKey, resumeData);
}

// ── Path approval UI (read/glob/grep outside workspace) ─────────────

/**
 * Show an approval prompt when a read-only tool accesses a path outside
 * the workspace restriction.
 */
async function handlePathApproval(
  client: PolosClient,
  handle: ExecutionHandle,
  suspend: SuspendEvent,
): Promise<void> {
  const form = suspend.data['_form'] as Record<string, unknown> | undefined;
  const context = (form?.['context'] ?? {}) as Record<string, unknown>;
  const toolName = String(context['tool'] ?? 'unknown');
  const targetPath = String(context['path'] ?? 'unknown');
  const restriction = String(context['restriction'] ?? '');

  printBanner(`${toolName.toUpperCase()}: PATH OUTSIDE WORKSPACE`);
  console.log(`\n  The agent wants to ${toolName} outside the workspace:\n`);
  console.log(`    Path:      ${targetPath}`);
  if (restriction) console.log(`    Workspace: ${restriction}`);
  console.log();

  const approved = await askYesNo('  Allow this access?');

  let feedback: string | undefined;
  if (!approved) {
    const response = await ask('  Feedback (tell the agent what to do instead): ');
    if (response) feedback = response;
  }

  const resumeData: Record<string, unknown> = { approved };
  if (feedback) resumeData['feedback'] = feedback;

  console.log(approved
    ? '\n  -> Allowed. Resuming...\n'
    : `\n  -> Denied${feedback ? ' with feedback' : ''}. Resuming...\n`);

  await client.resume(handle.rootWorkflowId, handle.id, suspend.stepKey, resumeData);
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

  printBanner('Local Sandbox Demo');
  console.log('\n  This demo runs an agent with local sandbox tools (no Docker).');
  console.log('  Since there is no container isolation:\n');
  console.log('  - exec, write, edit: always require approval');
  console.log('  - read, glob, grep: free within workspace, approval if outside\n');
  console.log('  Make sure the worker is running: npx tsx worker.ts\n');

  const task =
    'Create a file called hello.js that prints "Hello from the local sandbox!" and run it. ' +
    'Then create a second file called fibonacci.js that computes the first 10 Fibonacci numbers ' +
    'and prints them. Run that too.';

  console.log(`  Task: ${task}\n`);
  console.log('-'.repeat(60));

  const conversationId = randomUUID();

  console.log('\nInvoking agent...');
  const handle = await client.invoke(
    codingAgent.id, { input: task, conversationId, streaming: true }
  );
  console.log(`Execution ID: ${handle.id}`);
  console.log('Waiting for agent activity...\n');

  // Event loop: single persistent stream so concurrent suspends are never missed
  for await (const suspend of suspendEvents(client, handle)) {
    if (suspend.stepKey.startsWith('approve_exec')) {
      await handleExecApproval(client, handle, suspend);
    } else if (
      suspend.stepKey.startsWith('approve_write') ||
      suspend.stepKey.startsWith('approve_edit')
    ) {
      await handleFileApproval(client, handle, suspend);
    } else if (
      suspend.stepKey.startsWith('approve_read') ||
      suspend.stepKey.startsWith('approve_glob') ||
      suspend.stepKey.startsWith('approve_grep')
    ) {
      await handlePathApproval(client, handle, suspend);
    } else {
      console.log(`Received unexpected suspend: ${suspend.stepKey}`);
    }
  }

  // Fetch final result
  console.log('-'.repeat(60));
  console.log('\nFetching final result...');

  await new Promise((r) => setTimeout(r, 2000));
  const execution = await client.getExecution(handle.id);

  if (execution.status === 'completed') {
    printBanner('Agent Completed');
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

  rl.close();
}

main().catch(console.error);
