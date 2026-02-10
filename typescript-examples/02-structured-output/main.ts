/**
 * Run the movie_reviewer agent.
 *
 * This script invokes the movie_reviewer agent and waits for the result.
 *
 * Run with:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 */

import 'dotenv/config';
import { PolosClient } from '@polos/sdk';
import { movieReviewer } from './agents.js';

async function main() {
  // Get project_id from environment
  const projectId = process.env['POLOS_PROJECT_ID'];
  if (!projectId) {
    throw new Error(
      'POLOS_PROJECT_ID environment variable is required. ' +
        'Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). ' +
        'You can get this from the output printed by `polos-server start` or from the UI page at ' +
        "http://localhost:5173/projects/settings (the ID will be below the project name 'default')",
    );
  }

  // Create Polos client
  const client = new PolosClient({
    projectId,
    apiUrl: process.env['POLOS_API_URL'] ?? 'http://localhost:8080',
    apiKey: process.env['POLOS_API_KEY'] ?? '',
  });

  console.log('Invoking movie_reviewer agent...');

  const result = await movieReviewer.run(client, {
    input: "What's the review for the movie 'The Dark Knight'?",
  });

  console.log(result.result);
}

main().catch(console.error);
