/**
 * Lifecycle Hooks example using the unified Polos class.
 *
 * Starts an embedded worker and demonstrates agent execution with
 * lifecycle hooks attached. Watch the console output to see hooks
 * being triggered at each stage.
 *
 * Run with:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (defaults from env)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 *   OPENAI_API_KEY - OpenAI API key
 */

import 'dotenv/config';
import { Polos } from '@polos/sdk';

// Import agent, hook, and tool definitions to trigger global registry side-effects
import { loggedAgent, simpleLoggedAgent } from './agents.js';
import './hooks.js';
import './tools.js';

async function main() {
  const polos = new Polos({ deploymentId: 'lifecycle-hooks-examples', logFile: 'polos.log' });
  await polos.start();

  const client = polos.getClient();

  try {
    console.log('='.repeat(60));
    console.log('Lifecycle Hooks Demo');
    console.log('='.repeat(60));
    console.log();
    console.log('This demo invokes agents with lifecycle hooks attached.');
    console.log('Watch the console output to see the hooks being triggered!');
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
    console.log('Demo complete! Review the hook logs above.');
    console.log('='.repeat(60));
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
