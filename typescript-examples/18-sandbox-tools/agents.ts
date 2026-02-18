/**
 * Agent with sandbox tools for executing code inside a Docker container.
 *
 * The agent gets access to exec, read, write, edit, glob, and grep tools
 * that all operate inside an isolated Docker container with a bind-mounted
 * workspace directory.
 *
 * The sandbox lifecycle is fully managed — the container is created lazily
 * on first tool use and destroyed automatically when the execution completes.
 * The workspace directory defaults to POLOS_WORKSPACES_DIR/{projectId}/{sandboxId}.
 */

import { defineAgent, maxSteps, sandboxTools } from '@polos/sdk';
import { anthropic } from '@ai-sdk/anthropic';

// Create sandbox tools that run inside a Docker container.
// Workspace directory is managed automatically — set the POLOS_WORKSPACES_DIR
// env var to override the base path (defaults to /var/polos/workspaces).
export const tools = sandboxTools({
  env: 'docker',
  docker: {
    image: 'node:20-slim',
    // workspaceDir: '/path/to/project', // optional: override managed default
    // setupCommand: 'npm install',      // optional: run after container creation
    // memory: '512m',                   // optional: limit container memory
    // network: 'none',                  // optional: no network access
  },
  // scope: 'session',                   // optional: reuse sandbox across turns
});

// Define an agent that can write and run code in the sandbox
export const codingAgent = defineAgent({
  id: 'coding_agent',
  model: anthropic('claude-sonnet-4-5'),
  systemPrompt:
    'You are a coding agent with access to a sandbox environment. ' +
    'You can create files, edit code, run shell commands, and search the codebase. ' +
    'The workspace is at /workspace inside the container. ' +
    'Use the tools to complete the task, then summarize what you did and show the output. ' +
    'Always verify your work by running the code after writing it. ' +
    'In your final response, include the actual output from running the code.',
  tools,
  stopConditions: [maxSteps({ count: 50 })],
});
