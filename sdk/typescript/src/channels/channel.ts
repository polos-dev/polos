/**
 * Channel abstraction for delivering notifications when agents suspend.
 *
 * Channels are registered on the Worker and called automatically when any
 * workflow suspends (e.g., via ask_user or tool approval). Implementations
 * should be stateless and safe to call concurrently.
 */

import type { StreamEvent } from '../types/events.js';

/**
 * Originating channel context — identifies where a trigger came from
 * so that output and notifications can be routed back.
 */
export interface ChannelContext {
  /** Channel type: "slack", "discord", etc. */
  channelId: string;
  /** Channel-specific source metadata (e.g., { channel: "#general", threadTs: "..." }) */
  source: Record<string, unknown>;
}

/**
 * Controls how output events are streamed back to the originating channel.
 * - `per_step`: Stream text_delta, tool_call, step_finish, and finish events
 * - `final`: Only stream workflow_finish / agent_finish events
 * - `none`: Do not stream output
 */
export type ChannelOutputMode = 'per_step' | 'final' | 'none';

/**
 * Data passed to channels when an agent suspends for user input.
 */
export interface SuspendNotification {
  /** Root workflow ID */
  workflowId: string;
  /** Root execution ID */
  executionId: string;
  /** Step key used in suspend() */
  stepKey: string;
  /** URL to the approval page */
  approvalUrl: string;
  /** Title from _form schema */
  title?: string;
  /** Description from _form schema */
  description?: string;
  /** Source: "ask_user", "ask_before_use", or custom */
  source?: string;
  /** Tool name if triggered by ask_before_use */
  tool?: string;
  /** Read-only context data from _form */
  context?: Record<string, unknown>;
  /** Form field definitions from _form.fields */
  formFields?: Record<string, unknown>[];
  /** ISO timestamp when the approval expires */
  expiresAt?: string;
  /** Channel-specific overrides from _notify */
  channelOverrides?: Record<string, unknown>;
  /** Originating channel context — used for thread routing */
  channelContext?: ChannelContext;
}

/**
 * A notification channel for delivering suspend notifications to users.
 *
 * Channels are registered on the Worker and called automatically when any
 * workflow suspends. Implementations should be stateless and safe to call
 * concurrently.
 */
export interface Channel {
  /** Unique channel identifier (e.g., "slack", "discord", "email") */
  readonly id: string;

  /**
   * Send a notification when an agent suspends for user input.
   * Implementations should throw on failure — the SDK catches and logs errors.
   *
   * May return channel-specific metadata (e.g., Slack message_ts) so the
   * orchestrator can update the notification later (e.g., after approval via UI).
   */
  notify(notification: SuspendNotification): Promise<Record<string, unknown> | undefined>;

  /** Default output mode for this channel. */
  readonly outputMode?: ChannelOutputMode;

  /** Send output events back to the originating channel. */
  sendOutput?(context: ChannelContext, event: StreamEvent): Promise<void>;
}
