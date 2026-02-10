/**
 * Agents with lifecycle hooks attached.
 */

import { defineAgent, maxSteps } from '@polos/sdk';
import { openai } from '@ai-sdk/openai';
import { search, calculate } from './tools.js';
import {
  logStart,
  logEnd,
  logStepStart,
  logStepEnd,
  logToolStart,
  logToolEnd,
  validateInput,
} from './hooks.js';

// Agent with full lifecycle logging
export const loggedAgent = defineAgent({
  id: 'logged_agent',
  model: openai('gpt-4o-mini'),
  systemPrompt:
    'You are a helpful assistant with access to search and calculator tools. ' +
    'Use these tools to help answer user questions.',
  tools: [search, calculate],
  // Lifecycle hooks
  onStart: [validateInput, logStart], // Multiple hooks run in order
  onEnd: [logEnd],
  onAgentStepStart: [logStepStart],
  onAgentStepEnd: [logStepEnd],
  onToolStart: [logToolStart],
  onToolEnd: [logToolEnd],
  stopConditions: [maxSteps({ count: 5 })],
});

// Agent with just start/end logging
export const simpleLoggedAgent = defineAgent({
  id: 'simple_logged_agent',
  model: openai('gpt-4o-mini'),
  systemPrompt: 'You are a helpful assistant.',
  onStart: [logStart],
  onEnd: [logEnd],
  stopConditions: [maxSteps({ count: 5 })],
});

// Agent with input validation
export const validatedAgent = defineAgent({
  id: 'validated_agent',
  model: openai('gpt-4o-mini'),
  systemPrompt: 'You are a helpful assistant.',
  onStart: [validateInput], // Will reject empty or overly long prompts
  stopConditions: [maxSteps({ count: 5 })],
});
