/**
 * Thinking Agent example using the unified Polos class.
 *
 * This script starts an embedded worker, invokes the thinking agent
 * with a reasoning puzzle, and streams the result.
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
import { thinkingAgent } from './agents.js';

async function main() {
  const polos = new Polos({ deploymentId: 'thinking-agent-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    console.log('Invoking thinking agent...');

    const result = await thinkingAgent.stream(polos.getClient(), {
      input: 'A farmer has 17 sheep. All but 9 run away. How many sheep does the farmer have left?',
    });

    for await (const chunk of result.textChunks) {
      process.stdout.write(chunk);
    }

    console.log();
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
