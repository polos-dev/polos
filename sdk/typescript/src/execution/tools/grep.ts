/**
 * Grep tool — search file contents by pattern in the execution environment.
 *
 * When pathRestriction is set, searches within the restriction proceed
 * without approval. Custom cwd outside the restriction suspends for approval.
 */

import { resolve } from 'node:path';
import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow } from '../../core/tool.js';
import type { ExecutionEnvironment } from '../types.js';
import type { PathRestrictionConfig } from './path-approval.js';
import { isPathAllowed, requirePathApproval } from './path-approval.js';

/**
 * Create the grep tool for searching file contents.
 */
export function createGrepTool(
  getEnv: () => Promise<ExecutionEnvironment>,
  pathConfig?: PathRestrictionConfig
): ToolWorkflow {
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
    async (ctx, input) => {
      const env = await getEnv();

      // Check path restriction on custom cwd
      if (pathConfig?.pathRestriction && input.cwd) {
        const resolved = resolve(env.getCwd(), input.cwd);
        if (!isPathAllowed(resolved, pathConfig.pathRestriction)) {
          await requirePathApproval(ctx, 'grep', resolved, pathConfig.pathRestriction);
        }
      }

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
