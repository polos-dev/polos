/**
 * Polos Worker for the web search agent example.
 *
 * This worker registers the research agent and its tools (web search,
 * ask-user) with the Polos orchestrator.
 *
 * Prerequisites:
 *   - Polos server running (polos-server start)
 *   - TAVILY_API_KEY set (get one at https://tavily.com)
 *
 * Run with:
 *   npx tsx worker.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID    - Your project ID (required)
 *   POLOS_API_URL       - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY       - API key for authentication (optional for local dev)
 *   POLOS_DEPLOYMENT_ID - Deployment ID (default: web-search-agent-examples)
 *   ANTHROPIC_API_KEY   - Anthropic API key for the agent
 *   TAVILY_API_KEY      - Tavily API key for web search
 */

import 'dotenv/config';
import { Worker } from '@polos/sdk';
import { researchAgent, webSearch, askUser } from './agents.js';

async function main() {
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
  const deploymentId = process.env['POLOS_DEPLOYMENT_ID'] ?? 'web-search-agent-examples';

  // Register the agent and all tools with the worker
  const worker = new Worker({
    apiUrl,
    apiKey,
    projectId,
    deploymentId,
    workflows: [researchAgent, webSearch, askUser],
  });

  console.log('Starting web search agent worker...');
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Agent: ${researchAgent.id}`);
  console.log(`  Tools: [${webSearch.id}, ${askUser.id}]`);
  console.log('  Press Ctrl+C to stop\n');

  await worker.run();
}

main().catch(console.error);
