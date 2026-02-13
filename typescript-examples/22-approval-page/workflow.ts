/**
 * A workflow that requests approval via a web UI before proceeding.
 *
 * When it reaches the approval step, it suspends with _form metadata
 * that the Polos UI renders as an interactive form. The suspend event
 * also includes _approval_url so the client knows where to send the user.
 */

import { defineWorkflow } from '@polos/sdk';

interface DeployRequest {
  service: string;
  version: string;
  environment: string;
}

interface DeployResult {
  service: string;
  version: string;
  environment: string;
  status: string;
  approvedBy?: string;
  reason?: string;
}

export const deployWorkflow = defineWorkflow<DeployRequest, unknown, DeployResult>(
  { id: 'deploy_with_approval' },
  async (ctx, payload) => {
    // Step 1: Run pre-deploy checks
    const checks = await ctx.step.run('pre_deploy_checks', () => {
      console.log(`Running pre-deploy checks for ${payload.service} v${payload.version}...`);
      return {
        testsPass: true,
        buildSuccess: true,
        service: payload.service,
        version: payload.version,
      };
    });

    // Step 2: Suspend and wait for human approval via the web UI.
    // The _form schema tells the approval page what to render.
    const resumeData = await ctx.step.suspend<Record<string, unknown>, Record<string, unknown>>(
      'approve_deploy',
      {
        data: {
          _form: {
            title: `Deploy ${payload.service} v${payload.version}`,
            description: `Approve deployment to ${payload.environment}. All pre-deploy checks passed.`,
            fields: [
              {
                name: 'approved',
                type: 'boolean',
                label: 'Approve this deployment',
                default: false,
              },
              {
                name: 'approver',
                type: 'text',
                label: 'Your name',
                required: true,
              },
              {
                name: 'reason',
                type: 'textarea',
                label: 'Comments',
                description: 'Optional reason or notes for this decision',
              },
            ],
            context: {
              service: payload.service,
              version: payload.version,
              environment: payload.environment,
              tests: checks.testsPass ? 'passing' : 'failing',
              build: checks.buildSuccess ? 'success' : 'failed',
            },
          },
        },
        timeout: 86400, // 24 hour timeout
      },
    );

    // Step 3: Process the decision
    const decision = (resumeData?.['data'] ?? resumeData) as Record<string, unknown>;
    const approved = Boolean(decision['approved']);
    const approvedBy = String(decision['approver'] ?? 'unknown');
    const reason = decision['reason'] != null ? String(decision['reason']) : undefined;

    if (approved) {
      await ctx.step.run('execute_deploy', () => {
        console.log(`Deploying ${payload.service} v${payload.version} to ${payload.environment}...`);
        return { deployed: true };
      });
    }

    return {
      service: payload.service,
      version: payload.version,
      environment: payload.environment,
      status: approved ? 'deployed' : 'rejected',
      approvedBy,
      reason,
    };
  },
);
