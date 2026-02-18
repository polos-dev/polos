/**
 * Exec Security Example — unified single-file usage.
 *
 * Starts a Polos instance (worker + client), invokes a coding agent
 * whose exec tool has allowlist security. Commands that don't match the
 * allowlist suspend for approval. This script catches those suspend
 * events, shows the command to the user, and collects their decision
 * (approve / reject with feedback) before resuming.
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
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Polos } from '@polos/sdk';
import type { ExecutionHandle } from '@polos/sdk';
import { randomUUID } from 'node:crypto';

// Import for side-effects: triggers global registry registration
import './agents.js';

import { codingAgent } from './agents.js';

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
 * (e.g., from batched tool calls) are never missed. Non-suspend events
 * (text deltas, tool calls) are printed inline as side effects.
 */
async function* streamEvents(
  polos: Polos,
  handle: ExecutionHandle,
): AsyncGenerator<SuspendEvent> {
  for await (const event of polos.events.streamWorkflow(handle.rootWorkflowId, handle.id)) {
    const eventType = event.eventType;

    if (eventType?.startsWith('suspend_')) {
      const stepKey = eventType.slice('suspend_'.length);
      yield { stepKey, data: event.data as Record<string, unknown> };
    } else if (eventType === 'text_delta') {
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

// ── Approval UI ─────────────────────────────────────────────────────

/**
 * Show an approval prompt in the terminal and collect the user's decision.
 */
async function handleApproval(
  polos: Polos,
  handle: ExecutionHandle,
  suspend: SuspendEvent,
): Promise<void> {
  // Extract the form context — contains command, cwd, environment
  const form = suspend.data['_form'] as Record<string, unknown> | undefined;
  const context = (form?.['context'] ?? {}) as Record<string, unknown>;
  const command = String(context['command'] ?? 'unknown');
  const cwd = String(context['cwd'] ?? '');
  const environment = String(context['environment'] ?? '');

  printBanner('COMMAND APPROVAL REQUIRED');
  console.log('\n  The agent wants to run a command:\n');
  console.log(`    Command:     ${command}`);
  if (cwd) console.log(`    Directory:   ${cwd}`);
  if (environment) console.log(`    Environment: ${environment}`);
  console.log();

  const approved = await askYesNo('  Approve this command?');

  let feedback: string | undefined;
  if (!approved) {
    const response = await ask('  Feedback (tell the agent what to do instead): ');
    if (response) {
      feedback = response;
    }
  }

  // Build resume data matching the form fields
  const resumeData: Record<string, unknown> = {
    approved,
    allow_always: false,
  };
  if (feedback) {
    resumeData['feedback'] = feedback;
  }

  if (approved) {
    console.log('\n  -> Approved. Resuming workflow...\n');
  } else {
    console.log(`\n  -> Rejected${feedback ? ' with feedback' : ''}. Resuming workflow...\n`);
  }

  await polos.resume(handle.rootWorkflowId, handle.id, suspend.stepKey, resumeData);
}

// ── Ask-user UI ─────────────────────────────────────────────────────

/**
 * Show the agent's question in the terminal and collect the user's answer.
 */
async function handleAskUser(
  polos: Polos,
  handle: ExecutionHandle,
  suspend: SuspendEvent,
): Promise<void> {
  const form = suspend.data['_form'] as Record<string, unknown> | undefined;
  const title = String(form?.['title'] ?? 'Agent Question');
  const description = String(form?.['description'] ?? '');
  const fields = (form?.['fields'] ?? []) as Array<{
    key: string;
    type: string;
    label: string;
    description?: string;
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
  }>;

  printBanner(title);
  if (description) {
    console.log(`\n  ${description}\n`);
  }

  const resumeData: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.description) {
      console.log(`  (${field.description})`);
    }

    if (field.type === 'boolean') {
      resumeData[field.key] = await askYesNo(`  ${field.label}`);
    } else if (field.type === 'select' && field.options?.length) {
      console.log(`  ${field.label}`);
      for (let i = 0; i < field.options.length; i++) {
        console.log(`    ${i + 1}. ${field.options[i]!.label}`);
      }
      while (true) {
        const choice = await ask(`  Enter choice (1-${field.options.length}): `);
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < field.options.length) {
          resumeData[field.key] = field.options[idx]!.value;
          break;
        }
        console.log('  Invalid choice, try again.');
      }
    } else {
      // text, textarea, number
      const answer = await ask(`  ${field.label}: `);
      resumeData[field.key] = field.type === 'number' ? Number(answer) : answer;
    }
  }

  console.log('\n  -> Sending response to agent...\n');
  await polos.resume(handle.rootWorkflowId, handle.id, suspend.stepKey, resumeData);
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const polos = new Polos({ deploymentId: 'exec-security-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    printBanner('Exec Security Demo');
    console.log('\n  This demo shows how exec security works with an allowlist.');
    console.log('  Commands matching the allowlist (node, cat, echo, ls) run automatically.');
    console.log('  Everything else pauses for your approval.\n');
    console.log('  You can reject a command and provide feedback — the agent will');
    console.log('  read your feedback and try a different approach.\n');

    // Task that will trigger both allowed and non-allowed commands
    const task =
      'Create a file called greet.js that takes a name argument and prints a greeting. ' +
      'Run it with node to test it. ' +
      'Then install the "chalk" npm package and update greet.js to print the greeting in color. ' +
      'Run it again to verify it works.';

    console.log(`  Task: ${task}\n`);
    console.log('-'.repeat(60));

    const conversationId = randomUUID();

    // Start the agent
    console.log('\nInvoking agent...');
    const handle = await polos.invoke(
      codingAgent.id, { input: task, conversationId, streaming: true }
    );
    console.log(`Execution ID: ${handle.id}`);
    console.log('Streaming agent activity...\n');

    // Event loop: single persistent stream so concurrent suspends are never missed
    for await (const suspend of streamEvents(polos, handle)) {
      if (suspend.stepKey.startsWith('approve_exec')) {
        await handleApproval(polos, handle, suspend);
      } else if (suspend.stepKey.startsWith('ask_user')) {
        await handleAskUser(polos, handle, suspend);
      } else {
        console.log(`Received unexpected suspend: ${suspend.stepKey}`);
      }
    }

    // Fetch final result
    console.log('-'.repeat(60));
    console.log('\nFetching final result...');

    // Give the orchestrator a moment to finalize
    await new Promise((r) => setTimeout(r, 2000));
    const execution = await polos.getExecution(handle.id);

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
  } finally {
    rl.close();
    await polos.stop();
  }
}

main().catch(console.error);
