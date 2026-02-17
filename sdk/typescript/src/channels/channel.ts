/**
 * Channel abstraction for delivering notifications when agents suspend.
 *
 * Channels are registered on the Worker and called automatically when any
 * workflow suspends (e.g., via ask_user or tool approval). Implementations
 * should be stateless and safe to call concurrently.
 */

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
  /** ISO timestamp when the approval expires */
  expiresAt?: string;
  /** Channel-specific overrides from _notify */
  channelOverrides?: Record<string, unknown>;
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
   */
  notify(notification: SuspendNotification): Promise<void>;
}
