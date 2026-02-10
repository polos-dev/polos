/**
 * Conversational chat agent with tools.
 */

import { defineAgent, maxSteps } from '@polos/sdk';
import { openai } from '@ai-sdk/openai';
import { getCurrentTime, getWeather, calculator } from './tools.js';

// Conversational assistant with tools
export const chatAssistant = defineAgent({
  id: 'chat_assistant',
  model: openai('gpt-4o-mini'),
  systemPrompt:
    `You are a friendly and helpful assistant. You can:\n` +
    `- Tell the current time using the get_current_time tool\n` +
    `- Get weather information using the get_weather tool\n` +
    `- Perform calculations using the calculator tool\n\n` +
    `Be conversational and helpful.\n` +
    `When using tools, briefly explain what you're doing.`,
  tools: [getCurrentTime, getWeather, calculator],
  stopConditions: [maxSteps({ count: 10 })],
});
