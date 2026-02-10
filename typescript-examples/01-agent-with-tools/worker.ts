/**
 * Polos Worker for the Hello World example.
 *
 * This worker registers workflows and agents with the Polos orchestrator
 * and polls for tasks to execute.
 *
 * Run with:
 *   npx tsx worker.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 *   POLOS_DEPLOYMENT_ID - Deployment ID (default: agent-with-tools-examples)
 *   OPENAI_API_KEY - OpenAI API key for the weather agent
 */

import 'dotenv/config';
import { Worker } from '@polos/sdk';
import { getWeather } from './tools.js';
import { weatherAgent } from './agents.js';

async function main() {
  // Get project_id from environment (required)
  const projectId = process.env['POLOS_PROJECT_ID'];
  if (!projectId) {
    throw new Error(
      'POLOS_PROJECT_ID environment variable is required. ' +
        'Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). ' +
        'You can get this from the output printed by `polos-server start` or from the UI page at ' +
        "http://localhost:5173/projects/settings (the ID will be below the project name 'default')",
    );
  }

  const apiUrl = process.env['POLOS_API_URL'] ?? 'http://localhost:8080';
  const apiKey = process.env['POLOS_API_KEY'] ?? '';
  const deploymentId = process.env['POLOS_DEPLOYMENT_ID'] ?? 'agent-with-tools-examples';

  // Create worker with our workflows, agents, and tools
  const worker = new Worker({
    apiUrl,
    apiKey,
    projectId,
    deploymentId,
    workflows: [weatherAgent, getWeather],
  });

  console.log('Starting worker...');
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Agents: [${weatherAgent.id}]`);
  console.log('  Press Ctrl+C to stop\n');

  // Run worker (blocks until shutdown)
  await worker.run();
}

main().catch(console.error);
