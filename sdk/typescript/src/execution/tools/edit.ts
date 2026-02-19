/**
 * Edit tool — find-and-replace text in files in the execution environment.
 *
 * When pathRestriction is set, edits within the restriction proceed
 * without approval. Edits outside the restriction suspend for user approval.
 * Set approval to 'always' to require approval for every edit, or 'none'
 * to skip approval entirely (overrides path restriction).
 */

import { resolve } from 'node:path';
import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow, ToolApproval } from '../../core/tool.js';
import type { ExecutionEnvironment } from '../types.js';
import type { PathRestrictionConfig } from './path-approval.js';
import { isPathAllowed, requirePathApproval } from './path-approval.js';

export interface EditToolConfig {
  /** Explicit approval override. 'always' = approve every edit, 'none' = never approve. */
  approval?: ToolApproval;
  /** Path restriction config — edits inside are allowed, outside require approval. */
  pathConfig?: PathRestrictionConfig;
}

/**
 * Create the edit tool for find-and-replace in files.
 */
export function createEditTool(
  getEnv: () => Promise<ExecutionEnvironment>,
  config?: EditToolConfig
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
      // Only use blanket approval if explicitly set to 'always'
      approval: config?.approval === 'always' ? 'always' : undefined,
    },
    async (ctx, input) => {
      const env = await getEnv();

      // Path-restricted approval: approve if outside cwd, skip if inside
      if (!config?.approval && config?.pathConfig?.pathRestriction) {
        const resolved = resolve(env.getCwd(), input.path);
        if (!isPathAllowed(resolved, config.pathConfig.pathRestriction)) {
          await requirePathApproval(ctx, 'edit', resolved, config.pathConfig.pathRestriction);
        }
      }

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
