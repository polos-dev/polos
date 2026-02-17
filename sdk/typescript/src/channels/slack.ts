/**
 * Slack channel implementation — sends a Block Kit message with a "Respond"
 * link button when an agent suspends.
 *
 * Uses native `fetch` (Node 18+) — no @slack/web-api dependency required.
 */

import type { Channel, SuspendNotification } from './channel.js';

/**
 * Configuration for the Slack notification channel.
 */
export interface SlackChannelConfig {
  /** Slack bot token (xoxb-...) */
  botToken: string;
  /** Default Slack channel for notifications (e.g., "#agent-notifications") */
  defaultChannel: string;
}

/** Minimal Slack Block Kit block type. */
interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Record<string, unknown>[];
}

/**
 * Slack notification channel that posts Block Kit messages with a "Respond"
 * link button pointing to the approval page.
 */
export class SlackChannel implements Channel {
  readonly id = 'slack';
  private readonly config: SlackChannelConfig;

  constructor(config: SlackChannelConfig) {
    if (!config.botToken.startsWith('xoxb-')) {
      throw new Error(
        'Invalid Slack bot token: must start with "xoxb-". ' +
          "Use the Bot User OAuth Token from your Slack app's OAuth & Permissions page."
      );
    }
    this.config = config;
  }

  async notify(notification: SuspendNotification): Promise<void> {
    const overrides = notification.channelOverrides;
    const channel = (overrides?.['channel'] as string | undefined) ?? this.config.defaultChannel;
    const threadTs = overrides?.['thread_ts'] as string | undefined;
    const blocks = this.buildBlocks(notification);
    const text = notification.title ?? 'Agent needs your input';

    const body: Record<string, unknown> = { channel, text, blocks };
    if (threadTs) body['thread_ts'] = threadTs;

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error ?? 'unknown'}`);
    }
  }

  private buildBlocks(n: SuspendNotification): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    // Header
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: n.title ?? 'Agent needs your input' },
    });

    // Description
    if (n.description) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: n.description },
      });
    }

    // Source/tool metadata
    if (n.source || n.tool) {
      const parts: string[] = [];
      if (n.source) parts.push(`*Source:* ${n.source}`);
      if (n.tool) parts.push(`*Tool:* \`${n.tool}\``);
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: parts.join('  |  ') }],
      });
    }

    // Context data (tool arguments, etc.)
    if (n.context && Object.keys(n.context).length > 0) {
      const contextText = JSON.stringify(n.context, null, 2);
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '```' + contextText + '```' },
      });
    }

    // Expiry warning
    if (n.expiresAt) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Expires: ${n.expiresAt}` }],
      });
    }

    // Action button — link to approval page
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Respond' },
          url: n.approvalUrl,
          style: 'primary',
        },
      ],
    });

    return blocks;
  }
}
