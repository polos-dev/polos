/**
 * Glob tool — find files by pattern in the execution environment.
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
 * Create the glob tool for finding files by pattern.
 */
export function createGlobTool(
  getEnv: () => Promise<ExecutionEnvironment>,
  pathConfig?: PathRestrictionConfig
): ToolWorkflow {
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
    async (ctx, input) => {
      const env = await getEnv();

      // Check path restriction on custom cwd
      if (pathConfig?.pathRestriction && input.cwd) {
        const resolved = resolve(env.getCwd(), input.cwd);
        if (!isPathAllowed(resolved, pathConfig.pathRestriction)) {
          await requirePathApproval(ctx, 'glob', resolved, pathConfig.pathRestriction);
        }
      }

      const files = await env.glob(input.pattern, {
        cwd: input.cwd,
        ignore: input.ignore,
      });
      return { files };
    }
  ) as ToolWorkflow;
}
