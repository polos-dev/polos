/**
 * Slack Channel Example — bidirectional channels with output streaming.
 *
 * Starts a Polos instance with Slack channel notifications. Demonstrates:
 *
 * 1. **Tool approval** (approval: 'always') — Slack shows inline
 *    Approve / Reject / View Details buttons. Per-tool channels route
 *    approval notifications to #ops-approvals.
 *
 * 2. **ask_user** (freeform text) — Slack shows a "Respond" link button
 *    pointing to the approval page.
 *
 * 3. **Bidirectional channels** — When users @mention the bot in Slack,
 *    the agent is triggered and output streams back to the originating
 *    Slack thread via `sendOutput()`.
 *
 * 4. **Agent routing** — register your Slack app with the orchestrator
 *    (`POST /api/v1/slack/apps`). When a user @mentions the bot,
 *    the agent ID is parsed from the message (`@agent-id`).
 *
 * Run:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID     - Your project ID (default from env)
 *   POLOS_API_URL        - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY        - API key for authentication (optional for local development)
 *   SLACK_BOT_TOKEN      - Slack bot token, xoxb-... (required)
 *   SLACK_CHANNEL        - Default Slack channel (default: #agent-notifications)
 *   SLACK_SIGNING_SECRET - Slack app signing secret (set on orchestrator for interactive buttons)
 */

import 'dotenv/config';
import { Polos, SlackChannel, defineAgent, defineTool, createAskUserTool } from '@polos/sdk';
import { z } from 'zod';

const slackBotToken = process.env['SLACK_BOT_TOKEN'];
if (!slackBotToken) {
  throw new Error(
    'SLACK_BOT_TOKEN environment variable is required. ' +
      'Create a Slack app at https://api.slack.com/apps, add chat:write bot scope, ' +
      'install to your workspace, and copy the Bot User OAuth Token.',
  );
}

const defaultChannel = process.env['SLACK_CHANNEL'] ?? '#agent-notifications';
const opsChannel = process.env['SLACK_OPS_CHANNEL'] ?? '#ops-approvals';

// Helper to create a Slack channel targeting a specific Slack channel
const slack = (channel: string) =>
  new SlackChannel({
    botToken: slackBotToken,
    defaultChannel: channel,
  });

// Tool with approval: 'always' — suspends for approval before execution.
// Slack renders inline Approve/Reject buttons for this.
// Per-tool channel: tool approval notifications go to #ops-approvals.
const sendEmailTool = defineTool(
  {
    id: 'send_email',
    description: 'Send an email to a recipient. Requires approval before sending.',
    inputSchema: z.object({
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Email body text'),
    }),
    approval: 'always',
    channels: [slack(opsChannel)],
  },
  async (input) => {
    // Simulated — in production this would call an email API
    return { sent: true, to: input.to, subject: input.subject };
  },
);

// ask_user tool — freeform text input, Slack shows "Respond" link button
const askUserTool = createAskUserTool();

// Agent — when triggered from Slack, ask_user notifications route to the
// originating thread via channelContext (no explicit channels needed).
const assistantAgent = defineAgent({
  id: 'slack-assistant',
  model: 'anthropic:claude-sonnet-4-20250514',
  systemPrompt:
    'You are a helpful assistant that can send emails and ask users questions. ' +
    'When asked to send an email, use the send_email tool. ' +
    'When you need clarification, use the ask_user tool. ' +
    'Be concise and direct.',
  tools: [sendEmailTool, askUserTool],
});

async function main() {
  // Slack channel for output streaming and notifications.
  // When users @mention the bot in Slack with `@slack-assistant <message>`,
  // the orchestrator parses the agent ID and routes output back to the thread.
  const mainSlack = new SlackChannel({
    botToken: slackBotToken,
    defaultChannel,
  });

  const polos = new Polos({
    deploymentId: 'slack-channel-example',
    channels: [mainSlack],
    logFile: 'polos.log',
  });

  console.log('Starting Slack Channel Example (Bidirectional)...');
  console.log(`  Default channel: ${defaultChannel}`);
  console.log(`  Ops channel:     ${opsChannel}`);
  console.log(`  Agent: ${assistantAgent.id}`);
  console.log('');
  console.log('  Channel routing:');
  console.log(`    send_email tool → ${opsChannel} (tool approval)`);
  console.log(`    @mention in ${defaultChannel} → triggers slack-assistant`);
  console.log(`    Agent output → streams back to originating Slack thread`);
  console.log(`    ask_user (from Slack trigger) → routes to originating thread`);
  console.log(`    fallback → ${defaultChannel} (Worker-level default)`);
  console.log('');
  console.log('  Try:');
  console.log(`    @mention the bot in ${defaultChannel} with a message`);
  console.log('    "Send an email to alice@example.com about the Q1 report"');
  console.log(`      → Approve/Reject buttons in ${opsChannel}`);
  console.log('');
  console.log('  Press Ctrl+C to stop\n');

  await polos.serve();
}

main().catch(console.error);
