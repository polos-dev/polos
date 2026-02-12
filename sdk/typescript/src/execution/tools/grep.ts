/**
 * Grep tool — search file contents by pattern in the execution environment.
 */

import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow } from '../../core/tool.js';
import type { ExecutionEnvironment } from '../types.js';

/**
 * Create the grep tool for searching file contents.
 */
export function createGrepTool(getEnv: () => Promise<ExecutionEnvironment>): ToolWorkflow {
  return defineTool(
    {
      id: 'grep',
      description:
        'Search file contents for a pattern using grep. Returns matching lines with file paths ' +
        'and line numbers. Use this to find code patterns, references, or specific text.',
      inputSchema: z.object({
        pattern: z.string().describe('Search pattern (regex supported)'),
        cwd: z.string().optional().describe('Directory to search in'),
        include: z
          .array(z.string())
          .optional()
          .describe('File patterns to include (e.g., ["*.ts", "*.js"])'),
        maxResults: z
          .number()
          .optional()
          .describe('Maximum number of matches to return (default: 100)'),
        contextLines: z.number().optional().describe('Number of context lines around each match'),
      }),
    },
    async (_ctx, input) => {
      const env = await getEnv();
      const matches = await env.grep(input.pattern, {
        cwd: input.cwd,
        include: input.include,
        maxResults: input.maxResults,
        contextLines: input.contextLines,
      });
      return { matches };
    }
  ) as ToolWorkflow;
}
