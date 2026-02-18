/**
 * Agent Streaming example using the unified Polos class.
 *
 * Demonstrates three ways to consume streaming agent responses:
 *   1. Streaming text chunks
 *   2. Streaming full events
 *   3. Awaiting the final accumulated text
 *
 * Run with:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (defaults from env)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 *   OPENAI_API_KEY - OpenAI API key for the agent
 */

import 'dotenv/config';
import { Polos, type PolosClient } from '@polos/sdk';

// Import agent definition to trigger global registry side-effects
import { storyteller } from './agents.js';

async function streamTextChunks(client: PolosClient) {
  console.log('='.repeat(60));
  console.log('Example 1: Streaming Text Chunks');
  console.log('='.repeat(60));

  // Invoke with streaming
  const result = await storyteller.stream(client, {
    input: 'Tell me a short story about a robot learning to paint',
  });

  console.log(`Agent run ID: ${result.agentRunId}`);
  console.log(`Topic: ${result.topic}`);
  console.log('\nStreaming response:\n');

  // Iterate over text chunks as they arrive
  for await (const chunk of result.textChunks) {
    process.stdout.write(chunk);
  }

  console.log('\n');
}

async function streamFullEvents(client: PolosClient) {
  console.log('='.repeat(60));
  console.log('Example 2: Streaming Full Events');
  console.log('='.repeat(60));

  const result = await storyteller.stream(client, {
    input: 'Write a haiku about mountains',
  });

  console.log(`Agent run ID: ${result.agentRunId}`);
  console.log('\nStreaming events:\n');

  // Iterate over all events
  for await (const event of result.events) {
    const eventType = event.eventType;

    if (eventType === 'text_delta') {
      // Text chunk received
      const content = event.data['content'];
      if (typeof content === 'string') {
        process.stdout.write(content);
      }
    } else if (eventType === 'tool_call') {
      // Tool was called
      const toolCall = event.data['tool_call'] as Record<string, unknown> | undefined;
      const fn = toolCall?.['function'] as Record<string, unknown> | undefined;
      const toolName = fn?.['name'] ?? 'unknown';
      console.log(`\n[Tool Called: ${String(toolName)}]`);
    } else if (eventType === 'agent_finish') {
      // Agent finished
      console.log('\n[Agent completed]');
    }
  }

  console.log('\n');
}

async function getFinalText(client: PolosClient) {
  console.log('='.repeat(60));
  console.log('Example 3: Get Final Text');
  console.log('='.repeat(60));

  const result = await storyteller.stream(client, {
    input: 'What are three benefits of reading books?',
  });

  // Get the final accumulated text (waits for completion)
  const finalText = await result.text();

  console.log(`Agent run ID: ${result.agentRunId}`);
  console.log(`\nFinal text:\n${finalText}`);
  console.log();
}

async function main() {
  const polos = new Polos({ deploymentId: 'agent-streaming-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    const client = polos.getClient();

    await streamTextChunks(client);
    await streamFullEvents(client);
    await getFinalText(client);
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
