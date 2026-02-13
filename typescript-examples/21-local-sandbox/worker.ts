/**
 * Polos Worker for the local sandbox example.
 *
 * Registers the coding agent and its local sandbox tools with the
 * orchestrator. No Docker required — commands run directly on the host.
 *
 * Prerequisites:
 *   - Polos server running (polos-server start)
 *
 * Run with:
 *   npx tsx worker.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID    - Your project ID (required)
 *   POLOS_API_URL       - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY       - API key for authentication (optional for local dev)
 *   POLOS_DEPLOYMENT_ID - Deployment ID (default: local-sandbox-examples)
 *   ANTHROPIC_API_KEY   - Anthropic API key for the coding agent
 */

import 'dotenv/config';
import { Worker } from '@polos/sdk';
import { codingAgent, tools } from './agents.js';

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
  const deploymentId = process.env['POLOS_DEPLOYMENT_ID'] ?? 'local-sandbox-examples';

  const worker = new Worker({
    apiUrl,
    apiKey,
    projectId,
    deploymentId,
    workflows: [codingAgent, ...tools],
  });

  console.log('Starting local sandbox worker...');
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Agent: ${codingAgent.id}`);
  console.log(`  Tools: [${tools.map((t) => t.id).join(', ')}]`);
  console.log('  Environment: local (no Docker)');
  console.log('  Exec security: approval-always (default for local)');
  console.log('  Press Ctrl+C to stop\n');

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await tools.cleanup();
    process.exit(0);
  });

  await worker.run();
}

main().catch(console.error);
