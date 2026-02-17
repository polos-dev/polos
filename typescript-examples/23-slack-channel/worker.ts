/**
 * Polos Worker with Slack channel notifications.
 *
 * When an agent suspends (e.g., via ask_user), a Slack message is posted
 * with a "Respond" link button pointing to the approval page.
 *
 * Run with:
 *   npx tsx worker.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID    - Your project ID (required)
 *   POLOS_API_URL       - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY       - API key for authentication (optional for local development)
 *   POLOS_DEPLOYMENT_ID - Deployment ID (default: slack-channel-example)
 *   SLACK_BOT_TOKEN     - Slack bot token, xoxb-... (required)
 *   SLACK_CHANNEL       - Default Slack channel (default: #agent-notifications)
 */

import 'dotenv/config';
import { Worker, SlackChannel, defineAgent, createAskUserTool } from '@polos/sdk';

const projectId = process.env['POLOS_PROJECT_ID'];
if (!projectId) {
  throw new Error(
    'POLOS_PROJECT_ID environment variable is required. ' +
      'Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). ' +
      'You can get this from the output printed by `polos-server start` or from the UI page at ' +
      "http://localhost:5173/projects/settings (the ID will be below the project name 'default')",
  );
}

const slackBotToken = process.env['SLACK_BOT_TOKEN'];
if (!slackBotToken) {
  throw new Error(
    'SLACK_BOT_TOKEN environment variable is required. ' +
      'Create a Slack app at https://api.slack.com/apps, add chat:write bot scope, ' +
      'install to your workspace, and copy the Bot User OAuth Token.',
  );
}

const apiUrl = process.env['POLOS_API_URL'] ?? 'http://localhost:8080';
const apiKey = process.env['POLOS_API_KEY'] ?? '';
const deploymentId = process.env['POLOS_DEPLOYMENT_ID'] ?? 'slack-channel-example';
const slackChannel = process.env['SLACK_CHANNEL'] ?? '#agent-notifications';

// Create the Slack notification channel
const slack = new SlackChannel({
  botToken: slackBotToken,
  defaultChannel: slackChannel,
});

// Define an agent that uses ask_user — when it suspends, Slack gets notified
const askUserTool = createAskUserTool();

const assistantAgent = defineAgent({
  id: 'slack-assistant',
  model: 'anthropic:claude-sonnet-4-20250514',
  systemPrompt:
    'You are a helpful assistant. When you need clarification or a decision from ' +
    'the user, use the ask_user tool. Be concise and direct in your questions.',
  tools: [askUserTool],
});

async function main() {
  const worker = new Worker({
    apiUrl,
    apiKey,
    projectId,
    deploymentId,
    workflows: [assistantAgent],
    channels: [slack],
  });

  console.log('Starting Slack Channel Example worker...');
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Slack channel: ${slackChannel}`);
  console.log(`  Agent: ${assistantAgent.id}`);
  console.log('  Press Ctrl+C to stop\n');

  await worker.run();
}

main().catch(console.error);
