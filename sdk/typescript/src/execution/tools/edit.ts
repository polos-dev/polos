/**
 * Edit tool — find-and-replace text in files in the execution environment.
 */

import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow, ToolApproval } from '../../core/tool.js';
import type { ExecutionEnvironment } from '../types.js';

/**
 * Create the edit tool for find-and-replace in files.
 */
export function createEditTool(
  getEnv: () => Promise<ExecutionEnvironment>,
  approval?: ToolApproval
): ToolWorkflow {
  return defineTool(
    {
      id: 'edit',
      description:
        'Edit a file by replacing an exact string match. The old_text must match exactly ' +
        '(including whitespace and indentation). Use this for precise code modifications.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to edit'),
        old_text: z.string().describe('Exact text to find and replace'),
        new_text: z.string().describe('Text to replace the old_text with'),
      }),
      approval,
    },
    async (_ctx, input) => {
      const env = await getEnv();
      const content = await env.readFile(input.path);

      if (!content.includes(input.old_text)) {
        throw new Error(
          `old_text not found in ${input.path}. Make sure the text matches exactly, ` +
            'including whitespace and indentation.'
        );
      }

      const newContent = content.replace(input.old_text, input.new_text);
      await env.writeFile(input.path, newContent);

      return { success: true, path: input.path };
    }
  ) as ToolWorkflow;
}
