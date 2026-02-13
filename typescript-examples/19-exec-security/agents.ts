/**
 * Agent with sandbox tools and exec security.
 *
 * The exec tool is configured with an allowlist: commands matching the
 * patterns run immediately, everything else suspends for user approval.
 * The user can approve, reject, or reject with feedback so the agent
 * can adjust its approach.
 */

import { defineAgent, maxSteps, sandboxTools, createAskUserTool } from '@polos/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import path from 'node:path';

const workspaceDir = path.resolve(process.cwd(), 'workspace');

// Sandbox tools with exec security — only allowlisted commands run
// without approval. Everything else suspends for the user to decide.
export const tools = sandboxTools({
  env: 'docker',
  docker: {
    image: 'node:20-slim',
    workspaceDir,
    network: 'bridge',
  },
  exec: {
    security: 'allowlist',
    allowlist: [
      'node *',    // allow running node scripts
      'cat *',     // allow reading files
      'echo *',    // allow echo
      'ls *',      // allow listing
      'ls',        // allow bare ls
    ],
  },
});

// Ask-user tool — lets the agent ask the user questions during execution
const askUser = createAskUserTool();

export const codingAgent = defineAgent({
  id: 'secure_coding_agent',
  model: anthropic('claude-sonnet-4-5'),
  systemPrompt:
    'You are a coding agent with access to a sandbox environment. ' +
    'You can create files, edit code, run shell commands, and search the codebase. ' +
    'The workspace is at /workspace inside the container. ' +
    'Some commands may need user approval before running. If a command is rejected, ' +
    'read the user feedback in the error output and adjust your approach accordingly. ' +
    'Always verify your work by running the code after writing it. ' +
    'If you need clarification or a decision from the user, use the ask_user tool.',
  tools: [...tools, askUser],
  stopConditions: [maxSteps({ count: 30 })],
  conversationHistory: 50,
});
