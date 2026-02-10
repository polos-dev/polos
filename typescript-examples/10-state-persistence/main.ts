/**
 * Client demonstrating stateful workflows with persistent state.
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
  counterWorkflow,
  shoppingCartWorkflow,
  statefulWithInitialState,
} from './workflows.js';

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function demoCounterWorkflow(client: PolosClient): Promise<void> {
  printHeader('Counter Workflow Demo');

  // Increment the counter
  printSection('Incrementing counter');
  let result = await counterWorkflow.run(client, {
    action: 'increment',
    amount: 1,
  });
  console.log(`  Count = ${String(result.count)}`);

  // Increment by 5
  printSection('Incrementing by 5');
  result = await counterWorkflow.run(client, {
    action: 'increment',
    amount: 5,
  });
  console.log(`  Count after +5: ${String(result.count)}`);

  // Decrement by 2
  printSection('Decrementing by 2');
  result = await counterWorkflow.run(client, {
    action: 'decrement',
    amount: 2,
  });
  console.log(`  Count after -2: ${String(result.count)}`);

  // Reset
  printSection('Resetting counter');
  result = await counterWorkflow.run(client, {
    action: 'reset',
  });
  console.log(`  Count after reset: ${String(result.count)}`);
  console.log(`  Last updated: ${String(result.lastUpdated)}`);
}

async function demoShoppingCart(client: PolosClient): Promise<void> {
  printHeader('Shopping Cart Workflow Demo');
  console.log('This workflow adds items to a cart.');

  const result = await shoppingCartWorkflow.run(client, {
    action: 'add',
    item: { id: 'item-1', name: 'Laptop', price: 999.99, quantity: 1 },
  });
  console.log(`  Added: Laptop ($999.99 x 1)`);
  console.log(`  Cart total: $${String(result.total)}`);
}

async function demoInitialState(client: PolosClient): Promise<void> {
  printHeader('Initial State Demo');
  console.log('This workflow demonstrates passing initial state when invoking.');

  // Invoke without initial state (starts at 0)
  printSection('Without initial state');
  let result = await statefulWithInitialState.run(client, {
    increment: 5,
  });
  console.log(`  Original count: ${String(result.originalCount)}`);
  console.log(`  New count: ${String(result.newCount)}`);

  // Invoke with initial state
  printSection('With initial state (count=100)');
  result = await statefulWithInitialState.run(
    client,
    { increment: 5 },
    { initialState: { count: 100 } },
  );
  console.log(`  Original count: ${String(result.originalCount)}`);
  console.log(`  New count: ${String(result.newCount)}`);

  // Another example
  printSection('With initial state (count=50)');
  result = await statefulWithInitialState.run(
    client,
    { increment: 25 },
    { initialState: { count: 50 } },
  );
  console.log(`  Original count: ${String(result.originalCount)}`);
  console.log(`  New count: ${String(result.newCount)}`);
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
  console.log('State Persistence Workflow Examples');
  console.log('='.repeat(60));
  console.log('\nMake sure the worker is running: npx tsx worker.ts');

  try {
    await demoCounterWorkflow(client);
    await demoShoppingCart(client);
    await demoInitialState(client);

    console.log('\n' + '='.repeat(60));
    console.log('All demos completed!');
    console.log('='.repeat(60));
  } catch (e) {
    console.log(`\nError: ${String(e)}`);
    console.log('\nMake sure the worker is running and try again.');
  }
}

main().catch(console.error);
