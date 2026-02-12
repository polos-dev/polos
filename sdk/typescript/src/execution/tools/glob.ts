/**
 * Glob tool — find files by pattern in the execution environment.
 */

import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow } from '../../core/tool.js';
import type { ExecutionEnvironment } from '../types.js';

/**
 * Create the glob tool for finding files by pattern.
 */
export function createGlobTool(getEnv: () => Promise<ExecutionEnvironment>): ToolWorkflow {
  return defineTool(
    {
      id: 'glob',
      description:
        'Find files matching a glob pattern. Returns a list of file paths. ' +
        'Use this to discover files in the project structure.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern to match (e.g., "*.ts", "src/**/*.js")'),
        cwd: z.string().optional().describe('Directory to search in'),
        ignore: z.array(z.string()).optional().describe('Patterns to exclude from results'),
      }),
    },
    async (_ctx, input) => {
      const env = await getEnv();
      const files = await env.glob(input.pattern, {
        cwd: input.cwd,
        ignore: input.ignore,
      });
      return { files };
    }
  ) as ToolWorkflow;
}
