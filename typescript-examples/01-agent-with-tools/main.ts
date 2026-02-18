/**
 * Agent with Tools example using the unified Polos class.
 *
 * This script starts an embedded worker, invokes the weather agent,
 * and prints the result.
 *
 * Run with:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (defaults from env)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 *   OPENAI_API_KEY - OpenAI API key for the weather agent
 */

import 'dotenv/config';
import { Polos } from '@polos/sdk';

// Import agent and tool definitions to trigger global registry side-effects
import { weatherAgent } from './agents.js';
import './tools.js';

async function main() {
  const polos = new Polos({ deploymentId: 'agent-with-tools-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    console.log('Invoking weather_agent...');

    const result = await weatherAgent.run(polos, {
      input: "What's the weather like in Paris?",
    });

    console.log(result.result);
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
