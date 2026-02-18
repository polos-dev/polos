/**
 * Structured Output example using the unified Polos class.
 *
 * This script starts an embedded worker, invokes the movie_reviewer agent
 * with a Zod-typed output schema, and prints the structured result.
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

// Import agent definitions to trigger global registry side-effects
import { movieReviewer } from './agents.js';

async function main() {
  const polos = new Polos({ deploymentId: 'structured-output-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    console.log('Invoking movie_reviewer agent...');

    const result = await movieReviewer.run(polos, {
      input: "What's the review for the movie 'The Dark Knight'?",
    });

    console.log(result.result);
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
