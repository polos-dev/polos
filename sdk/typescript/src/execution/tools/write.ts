/**
 * Write tool — create or overwrite files in the execution environment.
 */

import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow, ToolApproval } from '../../core/tool.js';
import type { ExecutionEnvironment } from '../types.js';

/**
 * Create the write tool for writing file contents.
 */
export function createWriteTool(
  getEnv: () => Promise<ExecutionEnvironment>,
  approval?: ToolApproval
): ToolWorkflow {
  return defineTool(
    {
      id: 'write',
      description:
        'Write content to a file. Creates the file if it does not exist, or overwrites it if it does. ' +
        'Parent directories are created automatically.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to write'),
        content: z.string().describe('Content to write to the file'),
      }),
      approval,
    },
    async (_ctx, input) => {
      const env = await getEnv();
      await env.writeFile(input.path, input.content);
      return { success: true, path: input.path };
    }
  ) as ToolWorkflow;
}
