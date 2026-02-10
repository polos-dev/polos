/**
 * Thinking agents that use chain-of-thought reasoning.
 */

import { defineAgent, maxSteps } from '@polos/sdk';
import { openai } from '@ai-sdk/openai';
import { reasoningOutputSchema } from './schemas.js';

// Chain-of-thought reasoning agent
export const thinkingAgent = defineAgent({
  id: 'thinking_agent',
  model: openai('gpt-4o-mini'),
  systemPrompt:
    `You are a logical reasoning expert. When given a problem:\n\n` +
    `1. First, restate the problem to ensure understanding\n` +
    `2. Break down your thinking into clear, numbered steps\n` +
    `3. Consider potential pitfalls or trick questions\n` +
    `4. Arrive at a well-reasoned conclusion\n` +
    `5. State your confidence level\n\n` +
    `Always show your work and explain your reasoning clearly.\n` +
    `Use phrases like "Let me think...", "This means...", "Therefore..." to guide through your thought process.`,
  outputSchema: reasoningOutputSchema,
  stopConditions: [maxSteps({ count: 20 })],
});

// Math reasoning agent
export const mathReasoner = defineAgent({
  id: 'math_reasoner',
  model: openai('gpt-4o-mini'),
  systemPrompt:
    `You are a mathematics expert who solves problems step by step.\n\n` +
    `For each problem:\n` +
    `1. Identify what type of problem it is\n` +
    `2. List the known information\n` +
    `3. Determine what needs to be found\n` +
    `4. Show each calculation step with explanation\n` +
    `5. Verify your answer if possible\n\n` +
    `Be thorough but clear. Show all work.`,
  outputSchema: reasoningOutputSchema,
  stopConditions: [maxSteps({ count: 20 })],
});

// Logic puzzle solver
export const logicSolver = defineAgent({
  id: 'logic_solver',
  model: openai('gpt-4o-mini'),
  systemPrompt:
    `You are a logic puzzle expert. When solving puzzles:\n\n` +
    `1. List all given facts and constraints\n` +
    `2. Make deductions based on the constraints\n` +
    `3. Use process of elimination where applicable\n` +
    `4. Track your reasoning chain\n` +
    `5. Verify the solution satisfies all constraints\n\n` +
    `Think systematically and show your logical deductions.`,
  outputSchema: reasoningOutputSchema,
  stopConditions: [maxSteps({ count: 20 })],
});
