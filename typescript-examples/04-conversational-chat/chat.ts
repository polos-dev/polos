/**
 * Interactive chat client with streaming and tool execution display.
 *
 * Run the worker first:
 *   npx tsx worker.ts
 *
 * Then run this chat client:
 *   npx tsx chat.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (required)
 */

import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { PolosClient } from '@polos/sdk';
import { chatAssistant } from './agents.js';

async function chatLoop() {
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

  // Generate a conversation ID to maintain conversation context
  const conversationId = randomUUID();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('='.repeat(60));
  console.log('Conversational Chat with Streaming');
  console.log('='.repeat(60));
  console.log(`Conversation ID: ${conversationId}`);
  console.log("Type 'quit' or 'exit' to end the conversation.");
  console.log('='.repeat(60));
  console.log();

  try {
    while (true) {
      let userInput: string;
      try {
        userInput = (await rl.question('You: ')).trim();
      } catch {
        console.log('\nGoodbye!');
        break;
      }

      if (!userInput) continue;

      if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
        console.log('Goodbye!');
        break;
      }

      process.stdout.write('Assistant: ');

      try {
        const result = await chatAssistant.stream(client, {
          input: userInput,
          conversationId,
        });

        // Stream the response with tool call indicators
        for await (const event of result.events) {
          const eventType = event.eventType;

          if (eventType === 'text_delta') {
            const content = event.data['content'];
            if (typeof content === 'string') {
              process.stdout.write(content);
            }
          } else if (eventType === 'tool_call') {
            const toolCall = event.data['tool_call'] as Record<string, unknown> | undefined;
            const fn = toolCall?.['function'] as Record<string, unknown> | undefined;
            const toolName = fn?.['name'] ?? 'unknown';
            process.stdout.write(`\n  [Using ${String(toolName)}...]`);
          }
        }

        console.log(); // New line after response
        console.log(); // Extra spacing
      } catch (e) {
        console.log(`\nError: ${String(e)}`);
        console.log();
      }
    }
  } finally {
    rl.close();
  }
}

chatLoop().catch(console.error);
