/**
 * Read tool — read file contents from the execution environment.
 *
 * When pathRestriction is set, reads within the restriction proceed
 * without approval. Reads outside the restriction suspend for user approval.
 */

import { resolve } from 'node:path';
import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow } from '../../core/tool.js';
import type { ExecutionEnvironment } from '../types.js';
import type { PathRestrictionConfig } from './path-approval.js';
import { isPathAllowed, requirePathApproval } from './path-approval.js';

/**
 * Create the read tool for reading file contents.
 */
export function createReadTool(
  getEnv: () => Promise<ExecutionEnvironment>,
  pathConfig?: PathRestrictionConfig
): ToolWorkflow {
  return defineTool(
    {
      id: 'read',
      description:
        'Read the contents of a file. Returns the file content as text. ' +
        'Optionally specify offset (line number to start from, 0-based) and limit (number of lines).',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to read'),
        offset: z.number().optional().describe('Line offset to start reading from (0-based)'),
        limit: z.number().optional().describe('Maximum number of lines to return'),
      }),
    },
    async (ctx, input) => {
      const env = await getEnv();

      // Check path restriction — approve if outside
      if (pathConfig?.pathRestriction) {
        const resolved = resolve(env.getCwd(), input.path);
        if (!isPathAllowed(resolved, pathConfig.pathRestriction)) {
          await requirePathApproval(ctx, 'read', resolved, pathConfig.pathRestriction);
        }
      }

      let content = await env.readFile(input.path);

      // Apply offset/limit if specified
      if (input.offset !== undefined || input.limit !== undefined) {
        const lines = content.split('\n');
        const start = input.offset ?? 0;
        const end = input.limit !== undefined ? start + input.limit : lines.length;
        content = lines.slice(start, end).join('\n');
      }

      return { content, path: input.path };
    }
  ) as ToolWorkflow;
}
