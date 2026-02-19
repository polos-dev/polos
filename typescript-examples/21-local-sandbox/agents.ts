/**
 * Agent with sandbox tools running locally on the host machine.
 *
 * Uses `env: 'local'` instead of Docker — commands run directly on your
 * machine. Exec security defaults to 'approval-always' since there's no
 * container isolation: every shell command suspends for user approval.
 *
 * The workspace directory is auto-provisioned at
 * `~/.polos/workspaces/{projectId}/{sessionId}` — no manual `cwd` needed.
 */

import { defineAgent, maxSteps, sandboxTools } from '@polos/sdk';
import { anthropic } from '@ai-sdk/anthropic';

// Create sandbox tools that run locally on the host.
// The working directory is auto-provisioned per execution — no need to set `cwd`.
export const tools = sandboxTools({
  env: 'local',
  // Exec defaults to 'approval-always' for local mode.
  // Write and edit also require approval (fileApproval defaults to 'always').
  // You can override these defaults:
  //
  // exec: {
  //   security: 'allowlist',
  //   allowlist: ['node *', 'cat *', 'ls *', 'ls', 'echo *'],
  // },
  // fileApproval: 'none',  // disable write/edit approval
});

// Define an agent that can write and run code locally
export const codingAgent = defineAgent({
  id: 'local_coding_agent',
  model: anthropic('claude-sonnet-4-5'),
  systemPrompt:
    `You are a coding agent with access to the local filesystem. ` +
    `You can create files, edit code, run shell commands, and search the codebase. ` +
    `Use the tools to complete the task, then summarize what you did and show the output. ` +
    `Always verify your work by running the code after writing it. ` +
    `In your final response, include the actual output from running the code.`,
  tools,
  stopConditions: [maxSteps({ count: 30 })],
});
