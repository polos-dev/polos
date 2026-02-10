/**
 * Polos Worker for the Structured Output example.
 *
 * This example demonstrates how to use Zod schemas to get
 * structured, typed responses from agents.
 *
 * Run with:
 *   npx tsx worker.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 *   POLOS_DEPLOYMENT_ID - Deployment ID (default: structured-output-examples)
 *   OPENAI_API_KEY - OpenAI API key
 */

import 'dotenv/config';
import { Worker } from '@polos/sdk';
import { movieReviewer, recipeGenerator, sentimentAnalyzer } from './agents.js';

async function main() {
  const projectId = process.env['POLOS_PROJECT_ID'];
  if (!projectId) {
    throw new Error(
      'POLOS_PROJECT_ID environment variable is required. ' +
        "Get it from the Polos UI at http://localhost:5173/projects/settings",
    );
  }

  const apiUrl = process.env['POLOS_API_URL'] ?? 'http://localhost:8080';
  const apiKey = process.env['POLOS_API_KEY'] ?? '';
  const deploymentId = process.env['POLOS_DEPLOYMENT_ID'] ?? 'structured-output-examples';

  const worker = new Worker({
    apiUrl,
    apiKey,
    projectId,
    deploymentId,
    workflows: [movieReviewer, recipeGenerator, sentimentAnalyzer],
  });

  console.log('Starting Structured Output Examples worker...');
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Agents: [${[movieReviewer, recipeGenerator, sentimentAnalyzer].map((a) => a.id).join(', ')}]`);
  console.log('  Press Ctrl+C to stop\n');

  await worker.run();
}

main().catch(console.error);
