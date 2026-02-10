/**
 * Client demonstrating shared queues for concurrency control.
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
 *   POLOS_API_KEY - API key for authentication (required)
 */

import 'dotenv/config';
import { PolosClient } from '@polos/sdk';
import {
  apiCallWorkflow,
  dbReadWorkflow,
  dbWriteWorkflow,
  heavyProcessingWorkflow,
  inlineQueueWorkflow,
  namedQueueWorkflow,
  batchProcessor,
  queueOrchestrator,
} from './workflows.js';

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function demoApiQueue(client: PolosClient): Promise<void> {
  printHeader('API Queue Demo');
  console.log('The api-calls queue limits concurrent API requests to 5.');
  console.log('Invoking multiple API call workflows...');

  // Single API call
  printSection('Single API call');
  const result = await apiCallWorkflow.run(client, {
    url: 'https://api.example.com/users',
    method: 'GET',
  });
  console.log(`  URL: ${result.url}`);
  console.log(`  Method: ${result.method}`);
  console.log(`  Status: ${String(result.result.status)}`);

  // Multiple in parallel (will be queued by concurrency limit)
  printSection('Multiple API calls (queued by concurrency limit)');
  const urls = [
    'https://api.example.com/users/1',
    'https://api.example.com/users/2',
    'https://api.example.com/users/3',
  ];

  const handles = [];
  for (const url of urls) {
    const handle = await client.invoke('api_call', { url, method: 'GET' });
    handles.push(handle);
    console.log(`  Invoked: ${url} (execution: ${handle.id})`);
  }

  console.log(`\n  ${String(handles.length)} workflows queued on api-calls queue`);
}

async function demoDbQueue(client: PolosClient): Promise<void> {
  printHeader('Database Queue Demo');
  console.log('The database-ops queue is shared between db_read and db_write.');
  console.log('Total concurrent DB operations limited to 10.');

  // Database read
  printSection('Database read');
  const readResult = await dbReadWorkflow.run(client, {
    table: 'users',
    query: { active: true },
  });
  console.log(`  Table: ${String(readResult['table'])}`);
  console.log(`  Results: ${JSON.stringify(readResult['results'])}`);

  // Database write
  printSection('Database write');
  const writeResult = await dbWriteWorkflow.run(client, {
    table: 'users',
    data: { name: 'John Doe', email: 'john@example.com' },
  });
  console.log(`  Table: ${String(writeResult['table'])}`);
  console.log(`  Inserted: ${JSON.stringify(writeResult['inserted'])}`);

  // Mixed operations (all share same queue)
  printSection('Mixed read/write operations (shared queue)');
  const readHandle = await client.invoke('db_read', { table: 'orders' });
  const writeHandle = await client.invoke('db_write', {
    table: 'orders',
    data: { product: 'Widget' },
  });
  console.log(`  Read execution: ${readHandle.id.slice(0, 8)}...`);
  console.log(`  Write execution: ${writeHandle.id.slice(0, 8)}...`);
  console.log('  Both share the database-ops queue (limit: 10)');
}

async function demoHeavyQueue(client: PolosClient): Promise<void> {
  printHeader('Heavy Processing Queue Demo');
  console.log('The heavy-processing queue has low concurrency (2) for CPU-intensive work.');

  printSection('Heavy processing task');
  const result = await heavyProcessingWorkflow.run(client, {
    data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  });
  const processed = result['processed'] as Record<string, unknown>;
  console.log(`  Items processed: ${String(processed['itemsProcessed'])}`);
  console.log(`  Status: ${String(processed['status'])}`);

  // Invoke multiple heavy tasks
  printSection('Multiple heavy tasks (only 2 concurrent)');
  for (let i = 0; i < 3; i++) {
    const handle = await client.invoke('heavy_processing', {
      data: Array.from({ length: 10 }, (_, j) => i * 10 + j),
    });
    console.log(`  Task ${String(i + 1)} invoked: ${handle.id.slice(0, 8)}...`);
  }

  console.log('  Only 2 will run concurrently, 1 will wait in queue');
}

async function demoInlineAndNamedQueues(client: PolosClient): Promise<void> {
  printHeader('Inline and Named Queues Demo');

  // Inline queue
  printSection('Inline queue configuration');
  console.log("Workflow uses inline config: queue={ concurrencyLimit: 3 }");
  const inlineResult = await inlineQueueWorkflow.run(client, {});
  console.log(`  Result: ${String(inlineResult['message'])}`);

  // Named queue
  printSection('Named queue configuration');
  console.log("Workflow uses string queue name: queue='my-named-queue'");
  const namedResult = await namedQueueWorkflow.run(client, {});
  console.log(`  Result: ${String(namedResult['message'])}`);
}

async function demoBatchProcessor(client: PolosClient): Promise<void> {
  printHeader('Batch Processor Demo');
  console.log('The batch_processor shares the api-calls queue with api_call_workflow.');
  console.log('This ensures total API calls are limited across both workflows.');

  printSection('Processing batch of items');
  const items = [
    { url: 'https://api.example.com/item/1' },
    { url: 'https://api.example.com/item/2' },
    { url: 'https://api.example.com/item/3' },
  ];

  const result = await batchProcessor.run(client, { items });
  console.log(`  Items processed: ${String(result['processed'])}`);
  console.log('  All items share the api-calls queue (limit: 5)');
}

async function demoQueueOrchestrator(client: PolosClient): Promise<void> {
  printHeader('Queue Orchestrator Demo');
  console.log('The orchestrator invokes workflows that use different queues.');
  console.log('Each queue throttles its workflows independently.');

  printSection('Invoking workflows on different queues');
  const result = await queueOrchestrator.run(client, {});

  console.log(`  API workflow (api-calls queue): ${String(result['apiExecutionId']).slice(0, 8)}...`);
  console.log(`  DB workflow (database-ops queue): ${String(result['dbExecutionId']).slice(0, 8)}...`);
  console.log(`  Heavy workflow (heavy-processing queue): ${String(result['heavyExecutionId']).slice(0, 8)}...`);
  console.log("\n  Each workflow is throttled by its own queue's concurrency limit");
}

async function demoRuntimeConcurrency(client: PolosClient): Promise<void> {
  printHeader('Runtime Queue Concurrency Demo');
  console.log('This demo shows how to set queue concurrency at invocation time.');
  console.log('Each workflow sleeps for 2 seconds and prints when it starts/completes.');
  console.log('\nWatch the WORKER output until it completes!');

  const numWorkflows = 3;
  const sleepSeconds = 2.0;

  // Demo 1: Concurrency = 1 (sequential execution)
  printSection('Concurrency = 1 (Sequential Execution)');
  console.log(`Invoking ${String(numWorkflows)} workflows with queueConcurrencyLimit=1`);
  console.log('Workflows will execute ONE AT A TIME (sequentially).');
  console.log(`Expected time: ~${String(numWorkflows * sleepSeconds)} seconds\n`);

  let startTime = Date.now();

  let handles = [];
  for (let i = 0; i < numWorkflows; i++) {
    const handle = await client.invoke('slow_workflow', {
      workflowId: i + 1,
      sleepSeconds,
    }, {
      queueName: 'sequential-demo-queue',
      queueConcurrencyLimit: 1,
    });
    handles.push(handle);
    console.log(`  Invoked workflow ${String(i + 1)}: ${handle.id}`);
  }

  // Wait for all to complete
  console.log('\nWaiting for all workflows to complete...');
  console.log('(Watch the worker output until it completes)');

  for (const handle of handles) {
    await handle.getResult(60);
  }

  let elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n  All workflows completed in ${elapsed.toFixed(1)} seconds`);
  console.log('  (Sequential: workflows ran one after another)');

  // Demo 2: Concurrency = 3 (parallel execution)
  printSection('Concurrency = 3 (Parallel Execution)');
  console.log(`Invoking ${String(numWorkflows)} workflows with queueConcurrencyLimit=3`);
  console.log('All workflows will start AT THE SAME TIME (parallel).');
  console.log(`Expected time: ~${String(sleepSeconds)} seconds\n`);

  startTime = Date.now();

  handles = [];
  for (let i = 0; i < numWorkflows; i++) {
    const handle = await client.invoke('slow_workflow', {
      workflowId: i + 10,
      sleepSeconds,
    }, {
      queueName: 'parallel-demo-queue',
      queueConcurrencyLimit: 3,
    });
    handles.push(handle);
    console.log(`  Invoked workflow ${String(i + 10)}: ${handle.id}`);
  }

  // Wait for all to complete
  console.log('\nWaiting for all workflows to complete...');
  console.log('(Watch the worker output - all should start at once!)');

  for (const handle of handles) {
    await handle.getResult(60);
  }

  elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n  All workflows completed in ${elapsed.toFixed(1)} seconds`);
  console.log('  (Parallel: all workflows ran simultaneously)');
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
  console.log('Shared Queues Workflow Examples');
  console.log('='.repeat(60));
  console.log('\nMake sure the worker is running: npx tsx worker.ts');
  console.log('\nQueues defined in this example:');
  console.log('  - api-calls: concurrencyLimit=5 (for API requests)');
  console.log('  - database-ops: concurrencyLimit=10 (for DB operations)');
  console.log('  - heavy-processing: concurrencyLimit=2 (for CPU-intensive work)');

  try {
    await demoApiQueue(client);
    await demoDbQueue(client);
    await demoHeavyQueue(client);
    await demoInlineAndNamedQueues(client);
    await demoBatchProcessor(client);
    await demoQueueOrchestrator(client);
    await demoRuntimeConcurrency(client);

    console.log('\n' + '='.repeat(60));
    console.log('All demos completed!');
    console.log('='.repeat(60));
  } catch (e) {
    console.log(`\nError: ${String(e)}`);
    console.log('\nMake sure the worker is running and try again.');
  }
}

main().catch(console.error);
