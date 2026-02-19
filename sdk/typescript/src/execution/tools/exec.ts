/**
 * Exec tool — run shell commands inside the execution environment.
 */

import { z } from 'zod';
import { defineTool } from '../../core/tool.js';
import type { ToolWorkflow } from '../../core/tool.js';
import type { WorkflowContext } from '../../core/context.js';
import type { ExecutionEnvironment, ExecResult, ExecToolConfig } from '../types.js';
import { evaluateAllowlist } from '../security.js';

/**
 * Resume data shape from the approval form.
 */
interface ApprovalResumeData {
  data?: {
    approved?: boolean;
    allow_always?: boolean;
    feedback?: string;
  };
}

/**
 * Suspend for user approval of a command.
 */
async function requestApproval(
  ctx: WorkflowContext,
  command: string,
  env: ExecutionEnvironment
): Promise<{ approved: boolean; feedback?: string }> {
  const envInfo = env.getInfo();
  const approvalId = await ctx.step.uuid('_approval_id');
  const response = await ctx.step.suspend<Record<string, unknown>, ApprovalResumeData>(
    `approve_exec_${approvalId}`,
    {
      data: {
        _form: {
          title: 'Approve command execution',
          description: `The agent wants to run a shell command in the ${envInfo.type} environment.`,
          fields: [
            {
              key: 'approved',
              type: 'boolean',
              label: 'Approve this command?',
              required: true,
              default: false,
            },
            {
              key: 'allow_always',
              type: 'boolean',
              label: 'Always allow this command in the future?',
              required: false,
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
            command,
            cwd: env.getCwd(),
            environment: envInfo.type,
          },
        },
        _source: 'exec_security',
        _tool: 'exec',
      },
    }
  );

  const feedback = response.data?.feedback;
  return {
    approved: response.data?.approved === true,
    ...(feedback ? { feedback } : {}),
  };
}

/**
 * Build a rejected ExecResult.
 * Includes user feedback in stderr so the agent can adjust its approach.
 */
function rejectedResult(command: string, feedback?: string): ExecResult {
  let stderr = `Command rejected by user: ${command}`;
  if (feedback) {
    stderr += `\nUser feedback: ${feedback}`;
  }
  return {
    exitCode: -1,
    stdout: '',
    stderr,
    durationMs: 0,
    truncated: false,
  };
}

/**
 * Create the exec tool for running shell commands.
 */
export function createExecTool(
  getEnv: () => Promise<ExecutionEnvironment>,
  config?: ExecToolConfig
): ToolWorkflow {
  return defineTool(
    {
      id: 'exec',
      description:
        'Execute a shell command in the sandbox environment. Returns stdout, stderr, and exit code. ' +
        'Use this for running builds, tests, installing packages, or any shell operation.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute'),
        cwd: z.string().optional().describe('Working directory for the command'),
        env: z.record(z.string(), z.string()).optional().describe('Environment variables to set'),
        timeout: z.number().optional().describe('Timeout in seconds (default: 300)'),
      }),
    },
    async (ctx, input) => {
      const env = await getEnv();

      if (config?.security === 'approval-always') {
        const result = await requestApproval(ctx, input.command, env);
        if (!result.approved) return rejectedResult(input.command, result.feedback);
      } else if (config?.security === 'allowlist') {
        if (!evaluateAllowlist(input.command, config.allowlist ?? [])) {
          const result = await requestApproval(ctx, input.command, env);
          if (!result.approved) return rejectedResult(input.command, result.feedback);
        }
      }
      // 'allow-always' or undefined → no check

      return env.exec(input.command, {
        cwd: input.cwd,
        env: input.env,
        timeout: input.timeout ?? config?.timeout,
      });
    }
  ) as ToolWorkflow;
}
