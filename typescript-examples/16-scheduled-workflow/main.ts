/**
 * Client demonstrating scheduled workflow patterns.
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
import { PolosClient } from '@polos/sdk';
import type { SchedulePayload } from '@polos/sdk';
import { dailyCleanup } from './workflows.js';

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function demoCreateSchedule(client: PolosClient): Promise<void> {
  printHeader('Create Schedule Demo');
  console.log('This demo shows how to create a schedule dynamically using client.schedules.create().');
  console.log("The 'schedulable_reminder' workflow has no default schedule, meaning it can be");
  console.log('scheduled dynamically but has no fixed schedule.');

  printSection("Creating a schedule for 'schedulable_reminder'");

  // Create a schedule that runs every minute (for demo purposes)
  const cron = '* * * * *'; // Every minute
  const tz = 'UTC';
  const key = 'demo-user-123';

  console.log('  Workflow: schedulable_reminder');
  console.log(`  Cron: ${cron} (every minute)`);
  console.log(`  Timezone: ${tz}`);
  console.log(`  Key: ${key}`);

  const scheduleId = await client.schedules.create(
    'schedulable_reminder',
    cron,
    tz,
    key,
  );

  console.log('\n  Schedule created!');
  console.log(`  Schedule ID: ${scheduleId}`);
  console.log('\n  The workflow will now run automatically every minute.');
  console.log('  Check the worker logs to see the scheduled executions.');
}

async function demoCreatePerUserSchedules(client: PolosClient): Promise<void> {
  printHeader('Per-User Schedules Demo');
  console.log('This demo shows how to create different schedules for different users.');
  console.log('Each user gets their own schedule with the same workflow.');

  const users = [
    { id: 'user-alice', cron: '0 8 * * *', tz: 'America/New_York' },
    { id: 'user-bob', cron: '0 9 * * *', tz: 'Europe/London' },
    { id: 'user-charlie', cron: '0 7 * * *', tz: 'Asia/Tokyo' },
  ];

  printSection('Creating per-user schedules');

  for (const user of users) {
    const scheduleId = await client.schedules.create(
      'schedulable_reminder',
      user.cron,
      user.tz,
      user.id,
    );
    console.log(`  ${user.id}: ${user.cron} (${user.tz}) -> ${scheduleId}`);
  }

  console.log('\n  Each user now has their own personalized schedule!');
  console.log('  Alice: 8 AM New York time');
  console.log('  Bob: 9 AM London time');
  console.log('  Charlie: 7 AM Tokyo time');
}

async function demoManualTriggerWithSchedulePayload(client: PolosClient): Promise<void> {
  printHeader('Manual Trigger with SchedulePayload Demo');
  console.log('This demo shows how to manually trigger a scheduled workflow');
  console.log('by passing a SchedulePayload directly to run().');
  console.log('This is useful for testing scheduled workflows without waiting.');

  printSection("Running 'daily_cleanup' with manual SchedulePayload");

  // Create a SchedulePayload manually for testing
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const payload: SchedulePayload = {
    timestamp: now.toISOString(),
    lastTimestamp: yesterday.toISOString(),
    timezone: 'UTC',
    scheduleId: 'manual-test-schedule',
    key: 'manual-test',
    upcoming: tomorrow.toISOString(),
  };

  console.log(`  Timestamp: ${payload.timestamp}`);
  console.log(`  Last run: ${payload.lastTimestamp}`);
  console.log(`  Timezone: ${payload.timezone}`);
  console.log(`  Schedule ID: ${payload.scheduleId}`);
  console.log(`  Key: ${payload.key}`);
  console.log(`  Next run: ${payload.upcoming}`);

  // Run the workflow
  const result = await dailyCleanup.run(client, payload);

  printSection('Result');
  console.log(`  Timestamp: ${result.timestamp}`);
  console.log(`  Records cleaned: ${String(result.recordsCleaned)}`);
  console.log(`  Files cleaned: ${String(result.filesCleaned)}`);
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
  console.log('Scheduled Workflow Examples');
  console.log('='.repeat(60));
  console.log('\nMake sure the worker is running: npx tsx worker.ts');
  console.log('\nThis demo showcases scheduled workflow patterns:');
  console.log('  1. Creating schedules dynamically with client.schedules.create()');
  console.log('  2. Per-user/per-entity schedules');
  console.log('  3. Manually triggering scheduled workflow with SchedulePayload');

  try {
    await demoCreateSchedule(client);
    await demoCreatePerUserSchedules(client);
    await demoManualTriggerWithSchedulePayload(client);

    console.log('\n' + '='.repeat(60));
    console.log('All demos completed!');
    console.log('='.repeat(60));
    console.log('\nScheduled workflows will run automatically based on their cron expressions.');
    console.log('Check the worker logs to see scheduled executions.');
  } catch (e) {
    console.log(`\nError: ${String(e)}`);
    console.log('\nMake sure the worker is running and try again.');
  }
}

main().catch(console.error);
