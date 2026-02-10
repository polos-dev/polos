/**
 * Zod schemas for reasoning output.
 */

import { z } from 'zod';

/** Structured output schema for reasoning steps. */
export const reasoningOutputSchema = z.object({
  problem: z.string().describe('The original problem statement'),
  thinking_steps: z.array(z.string()).describe('Step-by-step reasoning process'),
  conclusion: z.string().describe('The final answer or conclusion'),
  confidence: z.string().describe('Confidence level: high, medium, or low'),
});

export type ReasoningOutput = z.infer<typeof reasoningOutputSchema>;
