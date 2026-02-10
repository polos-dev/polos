/**
 * Example workflows and agents for the Hello World example.
 */

import { defineAgent, maxSteps } from '@polos/sdk';
import { openai } from '@ai-sdk/openai';
import { getWeather } from './tools.js';

// Define a weather agent that can look up weather information
export const weatherAgent = defineAgent({
  id: 'weather_agent',
  model: openai('gpt-4o-mini'),
  systemPrompt:
    'You are a helpful weather assistant. Use the get_weather tool to look up weather information when asked.',
  tools: [getWeather],
  stopConditions: [maxSteps({ count: 10 })],
});
