/**
 * Interactive conversational chat with streaming using the unified Polos class.
 *
 * Starts an embedded worker and runs an interactive readline loop
 * with streaming agent responses.
 *
 * Run with:
 *   npx tsx chat.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (defaults from env)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 *   OPENAI_API_KEY - OpenAI API key
 */

import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { Polos } from '@polos/sdk';

// Import agent and tool definitions to trigger global registry side-effects
import { chatAssistant } from './agents.js';
import './tools.js';

async function chatLoop() {
  const polos = new Polos({ deploymentId: 'conversational-chat-examples', logFile: 'polos.log' });
  await polos.start();

  const client = polos.getClient();

  // Session ID groups all turns in this chat session — compaction
  // automatically summarises older messages so context is never lost.
  const sessionId = `chat-${Date.now()}`;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('='.repeat(60));
  console.log('Conversational Chat with Streaming');
  console.log('='.repeat(60));
  console.log(`Session ID: ${sessionId}`);
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
        const result = await chatAssistant.stream(
          client,
          { input: userInput },
          { sessionId },
        );

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
    await polos.stop();
  }
}

chatLoop().catch(console.error);
