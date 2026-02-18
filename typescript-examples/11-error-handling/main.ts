/**
 * Demonstrate error handling patterns in workflows.
 *
 * Run with:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 */

import 'dotenv/config';
import { Polos } from '@polos/sdk';
import {
  retryExample,
  errorRecovery,
  fallbackPattern,
  circuitBreaker,
  compensationPattern,
} from './workflows.js';

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function demoRetryExample(polos: Polos): Promise<void> {
  printHeader('Retry Example Demo');
  console.log('This workflow demonstrates automatic retry with exponential backoff.');
  console.log('The step may fail randomly but will be retried up to 3 times.');

  // Low failure rate — should succeed
  printSection('Low failure rate (10%)');
  try {
    const result = await retryExample.run(polos, {
      failureRate: 0.1,
      operation: 'low_risk_process',
    });
    console.log(`  Status: ${result.status}`);
    console.log(`  Result: ${JSON.stringify(result.result)}`);
  } catch (e) {
    console.log(`  Failed after retries: ${String(e)}`);
  }

  // High failure rate — likely to fail even with retries
  printSection('High failure rate (90%)');
  try {
    const result = await retryExample.run(polos, {
      failureRate: 0.9,
      operation: 'high_risk_process',
    });
    console.log(`  Status: ${result.status}`);
    console.log(`  Result: ${JSON.stringify(result.result)}`);
  } catch (e) {
    console.log(`  Failed after retries (expected): ${String(e)}`);
  }
}

async function demoErrorRecovery(polos: Polos): Promise<void> {
  printHeader('Error Recovery Demo');
  console.log('This workflow processes items and continues even if some fail.');
  console.log("Items with 'fail' in their name will fail.");

  printSection('Processing mixed items');
  const result = await errorRecovery.run(polos, {
    items: ['item1', 'item2', 'fail_item', 'item3', 'another_fail'],
  });

  console.log(`  Processed: ${String(result.processed)} items`);
  console.log(`  Failed: ${String(result.failed)} items`);

  if (result.results.length > 0) {
    console.log('\n  Successful results:');
    for (const r of result.results) {
      console.log(`    - ${r.item}: ${r.status}`);
    }
  }

  if (result.errors.length > 0) {
    console.log('\n  Errors:');
    for (const e of result.errors) {
      console.log(`    - ${e.item}: ${e.error.slice(0, 50)}...`);
    }
  }
}

async function demoFallbackPattern(polos: Polos): Promise<void> {
  printHeader('Fallback Pattern Demo');
  console.log('This workflow tries primary method first, then falls back if it fails.');

  // Primary method succeeds
  printSection('Primary method succeeds');
  let result = await fallbackPattern.run(polos, {
    data: { value: 'test_data' },
  });
  console.log(`  Method used: ${result.method}`);
  if (result.result) {
    console.log(`  Result: ${JSON.stringify(result.result)}`);
  }

  // Force primary to fail, use fallback
  printSection('Primary fails, using fallback');
  result = await fallbackPattern.run(polos, {
    data: { value: 'test_data', forceFailure: true },
  });
  console.log(`  Method used: ${result.method}`);
  if (result.result) {
    console.log(`  Result: ${JSON.stringify(result.result)}`);
    if (result.result['degraded']) {
      console.log('  (Running in degraded mode)');
    }
  }
}

async function demoCircuitBreaker(polos: Polos): Promise<void> {
  printHeader('Circuit Breaker Demo');
  console.log('This workflow stops processing after too many consecutive failures.');
  console.log('Circuit opens after 3 failures, remaining items are skipped.');

  printSection('Processing with circuit breaker');
  const items = [
    { id: 1, name: 'item1' },
    { id: 2, name: 'item2' },
    { id: 3, name: 'item3', shouldFail: true },
    { id: 4, name: 'item4', shouldFail: true },
    { id: 5, name: 'item5', shouldFail: true }, // This triggers circuit open
    { id: 6, name: 'item6' }, // Will be skipped
    { id: 7, name: 'item7' }, // Will be skipped
  ];

  const result = await circuitBreaker.run(polos, {
    items,
    failureThreshold: 3,
  });

  console.log(`  Circuit open: ${String(result.circuitOpen)}`);
  console.log(`  Total failures: ${String(result.totalFailures)}`);
  console.log('\n  Results:');
  for (const r of result.results) {
    const itemId = r.item?.id ?? '?';
    const reason = r.reason ? ` (${r.reason})` : '';
    console.log(`    - Item ${String(itemId)}: ${r.status}${reason}`);
  }
}

async function demoCompensationPattern(polos: Polos): Promise<void> {
  printHeader('Compensation Pattern Demo');
  console.log('This workflow performs a saga with compensation on failure.');
  console.log('Steps: reserve_inventory -> charge_payment -> send_confirmation');

  // Successful case
  printSection('Successful transaction');
  let result = await compensationPattern.run(polos, {
    orderId: 'ORDER-001',
  });
  console.log(`  Status: ${result.status}`);
  console.log(`  Completed steps: ${JSON.stringify(result.completed)}`);

  // Failure case — confirmation fails, triggers rollback
  printSection('Failed transaction with rollback');
  result = await compensationPattern.run(polos, {
    orderId: 'ORDER-002',
    failConfirmation: true,
  });
  console.log(`  Status: ${result.status}`);
  if (result.status === 'rolled_back') {
    console.log(`  Error: ${(result.error ?? 'Unknown').slice(0, 50)}...`);
    console.log(`  Compensated steps: ${JSON.stringify(result.compensated)}`);
  }
}

async function main(): Promise<void> {
  const polos = new Polos({ deploymentId: 'error-handling-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    console.log('='.repeat(60));
    console.log('Error Handling Workflow Examples');
    console.log('='.repeat(60));
    console.log('\nThis demo showcases various error handling patterns:');
    console.log('  1. Retry with exponential backoff');
    console.log('  2. Error recovery (continue on failure)');
    console.log('  3. Fallback pattern (primary/secondary)');
    console.log('  4. Circuit breaker (fail fast)');
    console.log('  5. Compensation pattern (saga rollback)');

    await demoRetryExample(polos);
    await demoErrorRecovery(polos);
    await demoFallbackPattern(polos);
    await demoCircuitBreaker(polos);
    await demoCompensationPattern(polos);

    console.log('\n' + '='.repeat(60));
    console.log('All demos completed!');
    console.log('='.repeat(60));
  } catch (e) {
    console.log(`\nError: ${String(e)}`);
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
