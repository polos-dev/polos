/**
 * Polos Worker for the exec security example.
 *
 * Registers the coding agent and its sandbox tools. The exec tool is
 * configured with an allowlist — non-matching commands suspend for
 * user approval before running.
 *
 * Prerequisites:
 *   - Docker must be installed and running
 *   - Polos server running (polos-server start)
 *
 * Run with:
 *   npx tsx worker.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID    - Your project ID (required)
 *   POLOS_API_URL       - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY       - API key for authentication (optional for local dev)
 *   POLOS_DEPLOYMENT_ID - Deployment ID (default: exec-security-examples)
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
  const deploymentId = process.env['POLOS_DEPLOYMENT_ID'] ?? 'exec-security-examples';

  const worker = new Worker({
    apiUrl,
    apiKey,
    projectId,
    deploymentId,
    workflows: [codingAgent, ...tools],
  });

  console.log('Starting exec security worker...');
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Agent: ${codingAgent.id}`);
  console.log(`  Tools: [${tools.map((t) => t.id).join(', ')}]`);
  console.log('  Exec security: allowlist mode');
  console.log('  Press Ctrl+C to stop\n');

  process.on('SIGINT', async () => {
    console.log('\nShutting down — cleaning up sandbox...');
    await tools.cleanup();
    process.exit(0);
  });

  await worker.run();
}

main().catch(console.error);
