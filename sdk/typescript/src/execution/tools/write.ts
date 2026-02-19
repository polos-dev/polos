/**
 * Write tool — create or overwrite files in the execution environment.
 *
 * When pathRestriction is set, writes within the restriction proceed
 * without approval. Writes outside the restriction suspend for user approval.
 * Set approval to 'always' to require approval for every write, or 'none'
 * to skip approval entirely (overrides path restriction).
 */

import { resolve } from 'node:path';
import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow, ToolApproval } from '../../core/tool.js';
import type { ExecutionEnvironment } from '../types.js';
import type { PathRestrictionConfig } from './path-approval.js';
import { isPathAllowed, requirePathApproval } from './path-approval.js';

export interface WriteToolConfig {
  /** Explicit approval override. 'always' = approve every write, 'none' = never approve. */
  approval?: ToolApproval;
  /** Path restriction config — writes inside are allowed, outside require approval. */
  pathConfig?: PathRestrictionConfig;
}

/**
 * Create the write tool for writing file contents.
 */
export function createWriteTool(
  getEnv: () => Promise<ExecutionEnvironment>,
  config?: WriteToolConfig
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
      // Only use blanket approval if explicitly set to 'always'
      approval: config?.approval === 'always' ? 'always' : undefined,
    },
    async (ctx, input) => {
      const env = await getEnv();

      // Path-restricted approval: approve if outside cwd, skip if inside
      if (!config?.approval && config?.pathConfig?.pathRestriction) {
        const resolved = resolve(env.getCwd(), input.path);
        if (!isPathAllowed(resolved, config.pathConfig.pathRestriction)) {
          await requirePathApproval(ctx, 'write', resolved, config.pathConfig.pathRestriction);
        }
      }

      await env.writeFile(input.path, input.content);
      return { success: true, path: input.path };
    }
  ) as ToolWorkflow;
}
