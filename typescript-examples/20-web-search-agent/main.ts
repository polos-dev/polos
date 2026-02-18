/**
 * Web Search Agent Example — unified single-file usage.
 *
 * Starts a Polos instance (worker + client), prompts the user for a
 * research question, streams the agent's activity (tool calls, text),
 * handles ask_user suspend events (prompts the user in the terminal
 * and resumes), then displays the final answer.
 *
 * Prerequisites:
 *   - Polos server running (polos-server start)
 *   - TAVILY_API_KEY set (get one at https://tavily.com)
 *
 * Run:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID  - Your project ID (default from env)
 *   POLOS_API_URL     - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY     - API key for authentication (optional for local dev)
 *   ANTHROPIC_API_KEY - Anthropic API key for the agent
 *   TAVILY_API_KEY    - Tavily API key for web search
 */

import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Polos } from '@polos/sdk';
import type { ExecutionHandle } from '@polos/sdk';

// Import for side-effects: triggers global registry registration
import './agents.js';

import { researchAgent } from './agents.js';

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
      const rawArgs = fn?.['arguments'];
      const toolArgs: Record<string, unknown> =
        typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs as Record<string, unknown>) ?? {};

      if (String(toolName) === 'web_search') {
        const query = toolArgs['query'] ?? '';
        console.log(`\n  [Searching the web: "${String(query)}"]`);
      } else if (String(toolName) === 'ask_user') {
        console.log('\n  [Agent has a question...]');
      } else {
        console.log(`\n  [Using ${String(toolName)}...]`);
      }
    }
  }
}

// ── Tool approval suspend handler ────────────────────────────────────

/**
 * Display the tool name and input, ask the user to approve or reject,
 * collect optional feedback, and resume the workflow.
 */
async function handleToolApproval(
  polos: Polos,
  handle: ExecutionHandle,
  suspend: SuspendEvent,
): Promise<void> {
  const form = suspend.data['_form'] as Record<string, unknown> | undefined;
  const context = (form?.['context'] ?? {}) as Record<string, unknown>;
  const toolName = String(context['tool'] ?? 'unknown');
  const toolInput = context['input'];

  printBanner('TOOL APPROVAL REQUIRED');
  console.log(`\n  The agent wants to use the "${toolName}" tool.\n`);
  if (toolInput !== undefined) {
    console.log(`  Input: ${JSON.stringify(toolInput, null, 2)}\n`);
  }

  const approved = await askYesNo('  Approve this tool call?');

  let feedback: string | undefined;
  if (!approved) {
    const response = await ask('  Feedback (tell the agent what to do instead): ');
    if (response) {
      feedback = response;
    }
  }

  const resumeData: Record<string, unknown> = { approved };
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

// ── Ask-user suspend handler ────────────────────────────────────────

/**
 * Display the agent's question in the terminal, collect the user's
 * response, and resume the workflow.
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
  const polos = new Polos({ deploymentId: 'web-search-agent-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    printBanner('Web Search Research Agent');
    console.log('\n  Ask a research question and the agent will search the web');
    console.log('  for current information. It may ask follow-up questions to');
    console.log('  refine its research.\n');

    // Prompt the user for their research question
    const question = await ask('  What would you like to research?\n\n  > ');
    if (!question) {
      console.log('  No question provided. Exiting.');
      rl.close();
      await polos.stop();
      return;
    }

    console.log();
    console.log('-'.repeat(60));

    // Start the agent
    console.log('\nInvoking research agent...');
    const handle = await polos.invoke(
      researchAgent.id, { input: question, streaming: true }
    );
    console.log(`Execution ID: ${handle.id}`);
    console.log('Streaming agent activity...\n');

    // Event loop: single persistent stream so concurrent suspends are never missed
    for await (const suspend of streamEvents(polos, handle)) {
      if (suspend.stepKey.startsWith('approve_')) {
        await handleToolApproval(polos, handle, suspend);
      } else if (suspend.stepKey.startsWith('ask_user')) {
        await handleAskUser(polos, handle, suspend);
      } else {
        console.log(`\nReceived unexpected suspend: ${suspend.stepKey}`);
      }
    }

    // Fetch final result
    console.log('\n' + '-'.repeat(60));
    console.log('\nFetching final result...');

    // Give the orchestrator a moment to finalize
    await new Promise((r) => setTimeout(r, 2000));
    const execution = await polos.getExecution(handle.id);

    if (execution.status === 'completed') {
      printBanner('Research Complete');
      const result =
        typeof execution.result === 'string'
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
