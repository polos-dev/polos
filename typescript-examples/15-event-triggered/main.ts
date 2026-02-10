/**
 * Client demonstrating event-triggered workflow patterns.
 *
 * Run the worker first:
 *   npx tsx worker.ts
 *
 * Then run this client:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 */

import 'dotenv/config';
import { PolosClient, sleep } from '@polos/sdk';
import {
  eventPublisher,
  eventWaiter,
} from './workflows.js';
import type { PublishEventPayload, WaitForEventPayload } from './workflows.js';

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function demoPublishEventTriggersWorkflow(client: PolosClient): Promise<void> {
  printHeader('Event-Triggered Workflow Demo');
  console.log('This demo shows how publishing an event triggers a workflow.');
  console.log("The 'on_order_created' workflow listens for 'orders/created' events.");

  printSection("Publishing event to 'orders/created' topic");

  const orderData = {
    order_id: 'ORD-12345',
    customer_id: 'CUST-001',
    items: [
      { product: 'Widget A', quantity: 2, price: 29.99 },
      { product: 'Widget B', quantity: 1, price: 49.99 },
    ],
    total: 109.97,
  };

  console.log(`  Order ID: ${orderData.order_id}`);
  console.log(`  Customer: ${orderData.customer_id}`);
  console.log(`  Total: $${String(orderData.total)}`);

  // Publish the event
  await client.events.publish(
    'orders/created',
    { eventType: 'order_created', data: orderData },
  );

  console.log('\n  Event published!');
  console.log("  The 'on_order_created' workflow should now be triggered.");
  console.log('  Check the worker logs to see the workflow execution.');
}

async function demoPublishUserSignup(client: PolosClient): Promise<void> {
  printHeader('User Signup Event Demo');
  console.log("Publishing a user signup event to trigger the 'on_user_signup' workflow.");

  printSection("Publishing event to 'users/signup' topic");

  const userData = {
    user_id: 'USER-42',
    email: 'newuser@example.com',
    name: 'New User',
  };

  console.log(`  User ID: ${userData.user_id}`);
  console.log(`  Email: ${userData.email}`);

  await client.events.publish(
    'users/signup',
    { eventType: 'user_signup', data: userData },
  );

  console.log('\n  Event published!');
  console.log("  The 'on_user_signup' workflow should now be triggered.");
}

async function demoBatchEvents(client: PolosClient): Promise<void> {
  printHeader('Batch Event Processing Demo');
  console.log('Publishing multiple events to trigger the batch processor workflow.');
  console.log('The workflow batches up to 10 events or waits 30 seconds.');

  printSection("Publishing 5 events to 'data/updates' topic");

  const eventsToPublish = Array.from({ length: 5 }, (_, i) => ({
    eventType: 'data_update',
    data: { record_id: `REC-${String(i + 1)}`, value: (i + 1) * 10 },
  }));

  for (let i = 0; i < eventsToPublish.length; i++) {
    const evt = eventsToPublish[i]!;
    console.log(`  Event ${String(i + 1)}: record_id=${evt.data['record_id'] as string}, value=${String(evt.data['value'])}`);
  }

  await client.events.batchPublish(
    'data/updates',
    eventsToPublish,
  );

  console.log('\n  Events published!');
  console.log("  The 'batch_processor' workflow will process these in a batch.");
  console.log('  (It may wait up to 30 seconds for more events before triggering)');
}

async function demoEventPublisherWorkflow(client: PolosClient): Promise<void> {
  printHeader('Event Publisher Workflow Demo');
  console.log('This workflow publishes events that can trigger other workflows.');

  printSection('Running event_publisher workflow');

  const payload: PublishEventPayload = {
    topic: 'orders/created',
    eventData: {
      order_id: 'ORD-FROM-WORKFLOW',
      customer_id: 'CUST-002',
      items: [{ product: 'Widget C', quantity: 3, price: 19.99 }],
      total: 59.97,
    },
    eventType: 'order_created',
  };

  console.log(`  Publishing to topic: ${payload.topic}`);
  console.log(`  Event type: ${payload.eventType}`);

  const result = await eventPublisher.run(client, payload);

  printSection('Result');
  console.log(`  Published: ${String(result.published)}`);
  console.log(`  Topic: ${result.topic}`);
  console.log(`  Event type: ${result.eventType}`);
  console.log("\n  This event will trigger the 'on_order_created' workflow!");
}

async function demoEventWaiterWorkflow(client: PolosClient): Promise<void> {
  printHeader('Event Waiter Workflow Demo');
  console.log('This workflow waits for an event on a specific topic.');
  console.log("We'll use a short timeout for demo purposes.");

  printSection('Starting event_waiter workflow');

  const topic = 'demo/notifications';
  const timeout = 10; // 10 second timeout for demo

  console.log(`  Waiting for events on topic: ${topic}`);
  console.log(`  Timeout: ${String(timeout)} seconds`);

  // Start the waiter workflow (invoke without waiting for result)
  const handle = await client.invoke('event_waiter', {
    topic,
    timeout,
  } satisfies WaitForEventPayload);

  console.log(`\n  Workflow started with execution ID: ${handle.id}`);
  console.log('  Workflow is now waiting for an event...');

  // Wait a moment then publish an event
  printSection('Publishing event to wake up the waiter');
  await sleep(2000);

  await client.events.publish(
    topic,
    {
      eventType: 'notification',
      data: { message: 'Hello from main.ts!', priority: 'high' },
    },
  );

  console.log('  Event published!');

  // Wait for the workflow to complete
  printSection('Waiting for workflow to complete');

  const result = await handle.getResult(30);
  console.log('  Workflow result:');
  console.log(`  ${JSON.stringify(result, null, 2)}`);
}

async function main(): Promise<void> {
  const projectId = process.env['POLOS_PROJECT_ID'];
  if (!projectId) {
    throw new Error(
      'POLOS_PROJECT_ID environment variable is required. ' +
        'Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). ' +
        'You can get this from the output printed by `polos-server start` or from the UI page at ' +
        "http://localhost:5173/projects/settings (the ID will be below the project name 'default')",
    );
  }

  const client = new PolosClient({
    projectId,
    apiUrl: process.env['POLOS_API_URL'] ?? 'http://localhost:8080',
    apiKey: process.env['POLOS_API_KEY'] ?? '',
  });

  console.log('='.repeat(60));
  console.log('Event-Triggered Workflow Examples');
  console.log('='.repeat(60));
  console.log('\nMake sure the worker is running: npx tsx worker.ts');
  console.log('\nThis demo showcases event-driven patterns:');
  console.log('  1. Publishing events that trigger workflows');
  console.log('  2. User signup event triggering onboarding');
  console.log('  3. Batch event processing');
  console.log('  4. Workflow that publishes events');
  console.log('  5. Workflow that waits for events');

  try {
    await demoPublishEventTriggersWorkflow(client);
    await demoPublishUserSignup(client);
    await demoBatchEvents(client);
    await demoEventPublisherWorkflow(client);
    await demoEventWaiterWorkflow(client);

    console.log('\n' + '='.repeat(60));
    console.log('All demos completed!');
    console.log('='.repeat(60));
    console.log('\nCheck the worker logs to see the event-triggered workflows execute.');
  } catch (e) {
    console.log(`\nError: ${String(e)}`);
    console.log('\nMake sure the worker is running and try again.');
  }
}

main().catch(console.error);
