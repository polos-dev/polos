/**
 * Slack channel implementation — sends a Block Kit message with a "Respond"
 * link button when an agent suspends.
 *
 * Uses native `fetch` (Node 18+) — no @slack/web-api dependency required.
 */

import type { Channel, ChannelContext, ChannelOutputMode, SuspendNotification } from './channel.js';
import type { StreamEvent } from '../types/events.js';

/**
 * Configuration for the Slack notification channel.
 */
export interface SlackChannelConfig {
  /** Slack bot token (xoxb-...) */
  botToken: string;
  /** Default Slack channel for notifications (e.g., "#agent-notifications") */
  defaultChannel: string;
  /** Slack signing secret for verifying inbound webhooks */
  signingSecret?: string;
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
  readonly outputMode: ChannelOutputMode = 'per_step';
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

    await this.postMessage(channel, threadTs, text, blocks);
  }

  async sendOutput(context: ChannelContext, event: StreamEvent): Promise<void> {
    const channel = context.source['channel'] as string;
    const threadTs = context.source['threadTs'] as string | undefined;
    if (!channel) return;

    const text = this.formatOutputEvent(event);
    if (!text) return;

    await this.postMessage(channel, threadTs, text);
  }

  private async postMessage(
    channel: string,
    threadTs: string | undefined,
    text: string,
    blocks?: SlackBlock[]
  ): Promise<void> {
    const body: Record<string, unknown> = { channel, text };
    if (threadTs) body['thread_ts'] = threadTs;
    if (blocks) body['blocks'] = blocks;

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

  private formatOutputEvent(event: StreamEvent): string | null {
    const eventType = event.eventType;

    if (eventType === 'workflow_finish' || eventType === 'agent_finish') {
      const metadata = event.data['_metadata'] as Record<string, unknown> | undefined;
      const result = event.data['result'];
      const error = event.data['error'] as string | undefined;
      const workflowId = metadata?.['workflow_id'] as string | undefined;
      if (error) {
        return `\u274C *${workflowId ?? 'Workflow'} failed:* ${error}`;
      }
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      if (resultStr) {
        return `\u2705 *${workflowId ?? 'Workflow'} finished:*\n${resultStr}`;
      }
      return `\u2705 *${workflowId ?? 'Workflow'} finished*`;
    }

    if (eventType === 'tool_call') {
      const toolCall = event.data['tool_call'] as Record<string, unknown> | undefined;
      if (toolCall) {
        const fn = toolCall['function'] as Record<string, unknown> | undefined;
        const name = fn?.['name'] as string | undefined;
        if (name) {
          return `\uD83D\uDD27 Calling tool: \`${name}\``;
        }
      }
      return null;
    }

    if (eventType === 'step_finish') {
      const stepKey = event.data['step_key'] as string | undefined;
      const error = event.data['error'] as string | undefined;
      if (error) {
        return `\u26A0\uFE0F Step \`${stepKey ?? 'unknown'}\` failed: ${error}`;
      }
      return null;
    }

    // text_delta: skip individual deltas to avoid noise
    return null;
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

    // Action buttons — inline Approve/Reject for simple approvals, link button otherwise
    if (this.isSimpleApproval(n)) {
      const approveValue = JSON.stringify({
        executionId: n.executionId,
        stepKey: n.stepKey,
        approved: true,
      });
      const rejectValue = JSON.stringify({
        executionId: n.executionId,
        stepKey: n.stepKey,
        approved: false,
      });
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: 'polos_approve',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            value: approveValue,
          },
          {
            type: 'button',
            action_id: 'polos_reject',
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            value: rejectValue,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Details' },
            url: n.approvalUrl,
          },
        ],
      });
    } else {
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
    }

    return blocks;
  }

  private isSimpleApproval(n: SuspendNotification): boolean {
    const fields = n.formFields;
    if (!fields || fields.length === 0) return false;
    return fields.some((f) => f['key'] === 'approved' && f['type'] === 'boolean');
  }
}
