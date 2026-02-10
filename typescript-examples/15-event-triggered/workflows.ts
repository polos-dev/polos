/**
 * Event-triggered workflow examples.
 *
 * Demonstrates workflows that are automatically triggered by events.
 * Events can come from external systems, other workflows, or scheduled triggers.
 */

import { defineWorkflow } from '@polos/sdk';
import type { EventPayload, BatchEventPayload } from '@polos/sdk';

// ============================================================================
// Payload / Result Types
// ============================================================================

interface OrderProcessedResult {
  orderId: string;
  status: string;
}

interface UserOnboardedResult {
  userId: string;
  onboarding: string;
}

interface BatchProcessResult {
  batchSize: number;
  processed: Record<string, unknown>[];
}

export interface PublishEventPayload {
  topic: string;
  eventData: Record<string, unknown>;
  eventType: string;
}

interface EventPublishedResult {
  published: boolean;
  topic: string;
  eventType: string;
}

export interface WaitForEventPayload {
  topic: string;
  timeout: number;
}

interface EventReceivedResult {
  received: boolean;
  eventTopic: string;
  eventType: string | undefined;
  eventData: Record<string, unknown>;
}

interface ChainPayload {
  action: string;
}

interface ChainResult {
  requestId: string;
  response: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

function processEventData(data: Record<string, unknown>): Record<string, unknown> {
  return { processed: true, data };
}

// ============================================================================
// Event-Triggered: Order Created
// ============================================================================

export const onOrderCreated = defineWorkflow<EventPayload, unknown, OrderProcessedResult>(
  {
    id: 'on_order_created',
    triggerOnEvent: 'orders/created',
  },
  async (ctx, payload) => {
    const orderData = payload.data;
    const orderId = (orderData['order_id'] as string) ?? 'unknown';

    await ctx.step.run(
      'started_order',
      () => console.log('Order processing started'),
    );

    // Process the order
    await ctx.step.run(
      'validate_order',
      () => ({ valid: true, orderId }),
    );

    // Reserve inventory
    await ctx.step.run(
      'reserve_inventory',
      () => ({ reserved: true }),
    );

    // Send confirmation
    await ctx.step.run(
      'send_confirmation',
      () => ({ sent: true }),
    );

    await ctx.step.run(
      'order_processed',
      () => console.log('Order processing completed'),
    );

    return { orderId, status: 'processed' };
  },
);

// ============================================================================
// Event-Triggered: User Signup
// ============================================================================

export const onUserSignup = defineWorkflow<EventPayload, unknown, UserOnboardedResult>(
  {
    id: 'on_user_signup',
    triggerOnEvent: 'users/signup',
  },
  async (ctx, payload) => {
    const userData = payload.data;
    const userId = (userData['user_id'] as string) ?? 'unknown';

    await ctx.step.run(
      'user_signed_up',
      () => console.log('User signed up'),
    );

    // Send welcome email
    await ctx.step.run(
      'send_welcome_email',
      () => ({ sent: true, userId }),
    );

    // Create initial setup
    await ctx.step.run(
      'create_user_settings',
      () => ({ created: true }),
    );

    // Track analytics event
    await ctx.step.run(
      'track_signup',
      () => ({ tracked: true }),
    );

    await ctx.step.run(
      'user_onboarded',
      () => console.log('User onboarded'),
    );

    return { userId, onboarding: 'complete' };
  },
);

// ============================================================================
// Event-Triggered: Batch Processor
// ============================================================================

export const batchProcessor = defineWorkflow<BatchEventPayload, unknown, BatchProcessResult>(
  {
    id: 'batch_processor',
    triggerOnEvent: 'data/updates',
    batchSize: 10,
    batchTimeoutSeconds: 30,
  },
  async (ctx, payload) => {
    await ctx.step.run(
      'batch_processor_started',
      () => console.log('Batch processor started'),
    );

    const processed: Record<string, unknown>[] = [];
    for (const event of payload.events) {
      const result = await ctx.step.run(
        `process_event_${String(event.sequenceId)}`,
        () => processEventData(event.data),
      );
      processed.push(result);
    }

    await ctx.step.run(
      'batch_processor_completed',
      () => console.log(`Batch processor completed. Processed ${String(payload.events.length)} events`),
    );

    return {
      batchSize: payload.events.length,
      processed,
    };
  },
);

// ============================================================================
// Event Publisher Workflow
// ============================================================================

export const eventPublisher = defineWorkflow<PublishEventPayload, unknown, EventPublishedResult>(
  { id: 'event_publisher' },
  async (ctx, payload) => {
    // Publish event
    await ctx.step.publishEvent(
      'publish_event',
      {
        topic: payload.topic,
        data: payload.eventData,
        type: payload.eventType,
      },
    );

    return {
      published: true,
      topic: payload.topic,
      eventType: payload.eventType,
    };
  },
);

// ============================================================================
// Event Waiter Workflow
// ============================================================================

export const eventWaiter = defineWorkflow<WaitForEventPayload, unknown, EventReceivedResult>(
  { id: 'event_waiter' },
  async (ctx, payload) => {
    // Wait for event
    const event = await ctx.step.waitForEvent<EventPayload>(
      'wait_for_notification',
      {
        topic: payload.topic,
        timeout: payload.timeout,
      },
    );

    await ctx.step.run(
      'event_received',
      () => console.log(`Event received: ${event.topic} ${JSON.stringify(event.data)}`),
    );

    return {
      received: true,
      eventTopic: event.topic,
      eventType: event.eventType,
      eventData: event.data,
    };
  },
);

// ============================================================================
// Chain with Events (request-response pattern)
// ============================================================================

export const chainWithEvents = defineWorkflow<ChainPayload, unknown, ChainResult>(
  { id: 'chain_with_events' },
  async (ctx, payload) => {
    const requestId = await ctx.step.uuid('request_id');

    // Publish a request event
    await ctx.step.publishEvent(
      'publish_request',
      {
        topic: `requests/${requestId}`,
        data: { requestId, action: payload.action },
        type: 'request',
      },
    );

    // Wait for response event
    const response = await ctx.step.waitForEvent<EventPayload>(
      'wait_for_response',
      {
        topic: `responses/${requestId}`,
        timeout: 300, // 5 minute timeout
      },
    );

    await ctx.step.run(
      'response_received',
      () => console.log(`Response received: ${response.topic} ${JSON.stringify(response.data)}`),
    );

    return {
      requestId,
      response: response.data,
    };
  },
);
