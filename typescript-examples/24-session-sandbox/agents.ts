/**
 * Agent with session-scoped sandbox tools.
 *
 * The key difference from example 18 (sandbox-tools) is `scope: 'session'`.
 * This tells the SandboxManager to reuse the same Docker container across
 * multiple invocations that share the same sessionId. Files created in one
 * invocation are visible in subsequent ones.
 */

import { defineAgent, maxSteps, sandboxTools } from '@polos/sdk';
import { anthropic } from '@ai-sdk/anthropic';

// Session-scoped sandbox tools — the container persists across agent runs
// that share the same sessionId. Workspace files survive between invocations.
export const tools = sandboxTools({
  scope: 'session',
  env: 'docker',
  docker: {
    image: 'node:20-slim',
  },
});

export const codingAgent = defineAgent({
  id: 'session_coding_agent',
  model: anthropic('claude-sonnet-4-5'),
  systemPrompt:
    'You are a coding agent with access to a persistent sandbox environment. ' +
    'You can create files, edit code, run shell commands, and search the codebase. ' +
    'The workspace is at /workspace inside the container. ' +
    'Files from previous turns in this session are still present — check what ' +
    'already exists before creating new files. ' +
    'Use the tools to complete the task, then summarize what you did and show the output. ' +
    'Always verify your work by running the code after writing it.',
  tools,
  stopConditions: [maxSteps({ count: 50 })],
});
