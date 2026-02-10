/**
 * Example tools for the lifecycle hooks demo.
 */

import { defineTool, type WorkflowContext } from '@polos/sdk';
import { z } from 'zod';

// ── search ──────────────────────────────────────────────────────────

const searchInputSchema = z.object({
  query: z.string(),
});

const searchOutputSchema = z.object({
  results: z.array(z.string()),
  total_count: z.number(),
});

type SearchInput = z.infer<typeof searchInputSchema>;
type SearchOutput = z.infer<typeof searchOutputSchema>;

export const search = defineTool(
  {
    id: 'search',
    description: 'Search for information on a topic',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
  },
  async (_ctx: WorkflowContext, input: SearchInput): Promise<SearchOutput> => {
    // Simulated search results based on query
    const results = [
      `Result 1 for '${input.query}'`,
      `Result 2 for '${input.query}'`,
      `Result 3 for '${input.query}'`,
    ];

    return { results, total_count: results.length };
  },
);

// ── calculate ───────────────────────────────────────────────────────

const calculateInputSchema = z.object({
  expression: z.string(),
});

const calculateOutputSchema = z.object({
  result: z.number().nullable(),
  error: z.string().nullable().optional(),
});

type CalculateInput = z.infer<typeof calculateInputSchema>;
type CalculateOutput = z.infer<typeof calculateOutputSchema>;

export const calculate = defineTool(
  {
    id: 'calculate',
    description: 'Calculate a mathematical expression',
    inputSchema: calculateInputSchema,
    outputSchema: calculateOutputSchema,
  },
  async (_ctx: WorkflowContext, input: CalculateInput): Promise<CalculateOutput> => {
    try {
      // Only allow safe math characters
      const allowed = /^[0-9+\-*/.() %]+$/;
      if (!allowed.test(input.expression)) {
        return { result: null, error: 'Invalid characters in expression' };
      }

      // eslint-disable-next-line no-eval -- safe: validated to only contain math chars
      const result = eval(input.expression) as number;
      return { result: Number(result), error: null };
    } catch (e) {
      return { result: null, error: String(e) };
    }
  },
);
