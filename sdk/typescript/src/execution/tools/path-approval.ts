/**
 * Path-based approval for sandbox tools.
 *
 * When pathRestriction is set, tools (read, write, edit, glob, grep) allow
 * operations within the restricted path without approval. Operations
 * outside the restriction suspend for user approval.
 */

import { resolve } from 'node:path';
import type { WorkflowContext } from '../../core/context.js';
import { isWithinRestriction } from '../security.js';

/**
 * Configuration for path-restricted approval on sandbox tools.
 */
export interface PathRestrictionConfig {
  /** Directory to allow without approval. Paths outside require approval. */
  pathRestriction: string;
}

/**
 * Resume data shape from the path approval form.
 */
interface PathApprovalResumeData {
  data?: { approved?: boolean; feedback?: string };
}

/**
 * Check whether a resolved path is within the restriction.
 */
export function isPathAllowed(resolvedPath: string, restriction: string): boolean {
  return isWithinRestriction(resolvedPath, resolve(restriction));
}

/**
 * Suspend for user approval when accessing a path outside the restriction.
 * Returns the approval result. Throws if rejected.
 */
export async function requirePathApproval(
  ctx: WorkflowContext,
  toolName: string,
  targetPath: string,
  restriction: string
): Promise<void> {
  const approvalId = await ctx.step.uuid('_approval_id');
  const response = await ctx.step.suspend<Record<string, unknown>, PathApprovalResumeData>(
    `approve_${toolName}_${approvalId}`,
    {
      data: {
        _form: {
          title: `${toolName}: access outside workspace`,
          description: `The agent wants to ${toolName} a path outside the workspace.`,
          fields: [
            {
              key: 'approved',
              type: 'boolean',
              label: 'Allow this operation?',
              required: true,
              default: false,
            },
            {
              key: 'feedback',
              type: 'textarea',
              label: 'Feedback for the agent (optional)',
              description: 'If rejecting, tell the agent what to do instead.',
              required: false,
            },
          ],
          context: {
            tool: toolName,
            path: targetPath,
            restriction,
          },
        },
        _source: 'path_approval',
        _tool: toolName,
      },
    }
  );

  if (response.data?.approved !== true) {
    const feedback = response.data?.feedback;
    throw new Error(
      `Access to "${targetPath}" was rejected by the user.${feedback ? ` Feedback: ${feedback}` : ''}`
    );
  }
}
