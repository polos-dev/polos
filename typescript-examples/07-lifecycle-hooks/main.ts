/**
 * Demonstrate agent execution with lifecycle hooks.
 *
 * Run the worker first:
 *   npx tsx worker.ts
 *
 * Then run this script:
 *   npx tsx main.ts
 *
 * Watch the worker terminal to see the hooks being triggered!
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (required)
 */

import 'dotenv/config';
import { PolosClient } from '@polos/sdk';
import { loggedAgent, simpleLoggedAgent } from './agents.js';

async function runLoggedAgentDemo() {
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

  console.log('='.repeat(60));
  console.log('Lifecycle Hooks Demo');
  console.log('='.repeat(60));
  console.log();
  console.log('This demo invokes agents with lifecycle hooks attached.');
  console.log('Watch the WORKER terminal to see the hooks being triggered!');
  console.log();
  console.log('-'.repeat(60));

  // Demo 1: Agent with full lifecycle logging and tools
  console.log('\n[Demo 1] Running logged_agent with search tool...');
  console.log("Request: 'Search for information about Python programming'");
  console.log();

  try {
    const result = await loggedAgent.stream(client, {
      input: 'Search for information about Python programming',
    });
    const text = await result.text();
    console.log(`Result: ${text}`);
  } catch (e) {
    console.log(`Error: ${String(e)}`);
  }

  console.log();
  console.log('-'.repeat(60));

  // Demo 2: Agent with calculator tool
  console.log('\n[Demo 2] Running logged_agent with calculator...');
  console.log("Request: 'What is 42 * 17?'");
  console.log();

  try {
    const result = await loggedAgent.stream(client, {
      input: 'What is 42 * 17?',
    });
    const text = await result.text();
    console.log(`Result: ${text}`);
  } catch (e) {
    console.log(`Error: ${String(e)}`);
  }

  console.log();
  console.log('-'.repeat(60));

  // Demo 3: Simple agent with just start/end hooks
  console.log('\n[Demo 3] Running simple_logged_agent (start/end hooks only)...');
  console.log("Request: 'What is the capital of France?'");
  console.log();

  try {
    const result = await simpleLoggedAgent.stream(client, {
      input: 'What is the capital of France?',
    });
    const text = await result.text();
    console.log(`Result: ${text}`);
  } catch (e) {
    console.log(`Error: ${String(e)}`);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Demo complete! Check the worker terminal for hook logs.');
  console.log('='.repeat(60));
}

runLoggedAgentDemo().catch(console.error);
