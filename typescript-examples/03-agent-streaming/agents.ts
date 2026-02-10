/**
 * Agents for the streaming example.
 */

import { defineAgent, maxSteps } from '@polos/sdk';
import { anthropic } from '@ai-sdk/anthropic';

// Storyteller agent - good for demonstrating streaming with longer outputs
export const storyteller = defineAgent({
  id: 'storyteller',
  model: anthropic('claude-sonnet-4-5'),
  systemPrompt:
    `You are a creative storyteller. When asked for a story, ` +
    `tell an engaging, vivid story with descriptions and dialogue. ` +
    `Keep stories between 200-400 words unless asked for a different length.`,
  stopConditions: [maxSteps({ count: 5 })],
});
