/**
 * Polos Worker for the Error Handling example.
 *
 * Run with:
 *   npx tsx worker.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 *   POLOS_DEPLOYMENT_ID - Deployment ID (default: error-handling-examples)
 */

import 'dotenv/config';
import { Worker } from '@polos/sdk';
import {
  retryExample,
  errorRecovery,
  fallbackPattern,
  circuitBreaker,
  compensationPattern,
} from './workflows.js';

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
  const deploymentId = process.env['POLOS_DEPLOYMENT_ID'] ?? 'error-handling-examples';

  const worker = new Worker({
    apiUrl,
    apiKey,
    projectId,
    deploymentId,
    workflows: [retryExample, errorRecovery, fallbackPattern, circuitBreaker, compensationPattern],
  });

  console.log('Starting Error Handling Examples worker...');
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Workflows: [${[retryExample, errorRecovery, fallbackPattern, circuitBreaker, compensationPattern].map((w) => w.id).join(', ')}]`);
  console.log('  Press Ctrl+C to stop\n');

  await worker.run();
}

main().catch(console.error);
