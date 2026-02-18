/**
 * Slack Channel Example — unified single-file usage.
 *
 * Starts a Polos instance with Slack channel notifications. When an
 * agent suspends (e.g., via ask_user), a Slack message is posted with
 * a "Respond" link button pointing to the approval page.
 *
 * Run:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (default from env)
 *   POLOS_API_URL    - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY    - API key for authentication (optional for local development)
 *   SLACK_BOT_TOKEN  - Slack bot token, xoxb-... (required)
 *   SLACK_CHANNEL    - Default Slack channel (default: #agent-notifications)
 */

import 'dotenv/config';
import { Polos, SlackChannel, defineAgent, createAskUserTool } from '@polos/sdk';

const slackBotToken = process.env['SLACK_BOT_TOKEN'];
if (!slackBotToken) {
  throw new Error(
    'SLACK_BOT_TOKEN environment variable is required. ' +
      'Create a Slack app at https://api.slack.com/apps, add chat:write bot scope, ' +
      'install to your workspace, and copy the Bot User OAuth Token.',
  );
}

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
  const polos = new Polos({
    deploymentId: 'slack-channel-example',
    channels: [slack],
    logFile: 'polos.log',
  });

  console.log('Starting Slack Channel Example...');
  console.log(`  Slack channel: ${slackChannel}`);
  console.log(`  Agent: ${assistantAgent.id}`);
  console.log('  Press Ctrl+C to stop\n');

  await polos.serve();
}

main().catch(console.error);
