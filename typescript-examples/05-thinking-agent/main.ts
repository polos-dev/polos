/**
 * Run the thinking agent.
 *
 * This script invokes the thinking agent and streams the result.
 *
 * Run with:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (required)
 */

import 'dotenv/config';
import { PolosClient } from '@polos/sdk';
import { thinkingAgent } from './agents.js';

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

  const client = new PolosClient({
    projectId,
    apiUrl: process.env['POLOS_API_URL'] ?? 'http://localhost:8080',
    apiKey: process.env['POLOS_API_KEY'] ?? '',
  });

  console.log('Invoking thinking agent...');

  const result = await thinkingAgent.stream(client, {
    input: 'A farmer has 17 sheep. All but 9 run away. How many sheep does the farmer have left?',
  });

  for await (const chunk of result.textChunks) {
    process.stdout.write(chunk);
  }

  console.log();
}

main().catch(console.error);
