/**
 * Demonstrate parallel workflow execution patterns.
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
  singleReview,
  parallelReview,
  dataChunkProcessor,
  fireAndForgetBatch,
} from './workflows.js';
import type { ReviewRequest } from './workflows.js';

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function demoSingleReview(polos: Polos): Promise<void> {
  printHeader('Single Review Demo');
  console.log('This workflow processes a single document review.');

  printSection('Running single review');
  const result = await singleReview.run(polos, {
    reviewerId: 'alice',
    documentId: 'DOC-001',
    content: 'This is a sample document for review. It contains important information.',
  });

  console.log(`  Reviewer: ${result.reviewerId}`);
  console.log(`  Document: ${result.documentId}`);
  console.log(`  Approved: ${String(result.approved)}`);
  console.log(`  Score: ${String(result.score)}/10`);
  console.log(`  Comments: ${result.comments}`);
}

async function demoParallelReview(polos: Polos): Promise<void> {
  printHeader('Parallel Review Demo');
  console.log('This workflow runs multiple reviews in parallel and aggregates results.');
  console.log('Uses batchInvokeAndWait to run all reviews concurrently.');

  printSection('Submitting document for parallel review');
  const reviewers = ['alice', 'bob', 'charlie', 'diana'];
  console.log('  Document: DOC-002');
  console.log(`  Reviewers: ${reviewers.join(', ')}`);

  const result = await parallelReview.run(polos, {
    documentId: 'DOC-002',
    content: 'This is an important proposal document that requires multiple approvals.',
    reviewers,
  });

  printSection('Aggregated Results');
  console.log(`  Document ID: ${result.documentId}`);
  console.log(`  Total Reviews: ${String(result.totalReviews)}`);
  console.log(`  Approved Count: ${String(result.approvedCount)}/${String(result.totalReviews)}`);
  console.log(`  Average Score: ${(result.averageScore ?? 0).toFixed(1)}/10`);
  console.log(`  All Approved: ${String(result.allApproved ?? false)}`);

  console.log('\n  Individual Reviews:');
  for (const review of result.reviews) {
    const status = review.approved ? '[OK]' : '[X]';
    console.log(`    ${status} ${review.reviewerId}: score=${String(review.score)}`);
  }
}

async function demoDataChunkProcessor(polos: Polos): Promise<void> {
  printHeader('Data Chunk Processor Demo');
  console.log('This workflow splits data into chunks and processes them in parallel.');
  console.log('Demonstrates fan-out/fan-in pattern for data processing.');

  // Create sample data
  const data = Array.from({ length: 25 }, (_, i) => `item_${String(i)}`);
  const chunkSize = 10;

  printSection('Processing data in parallel chunks');
  console.log(`  Total items: ${String(data.length)}`);
  console.log(`  Chunk size: ${String(chunkSize)}`);
  console.log(`  Number of chunks: ${String(Math.ceil(data.length / chunkSize))}`);

  const result = await dataChunkProcessor.run(polos, { data, chunkSize });

  printSection('Processing Results');
  console.log(`  Total items: ${String(result.totalItems)}`);
  console.log(`  Chunks processed: ${String(result.chunksProcessed)}`);
  console.log(`  Items processed: ${String(result.processedItems)}`);
  console.log('\n  Sample results (first 5):');
  for (const item of result.results.slice(0, 5)) {
    console.log(`    - ${String(item)}`);
  }
}

async function demoFireAndForget(polos: Polos): Promise<void> {
  printHeader('Fire and Forget Batch Demo');
  console.log('This workflow launches multiple background tasks without waiting.');
  console.log("Returns execution IDs for tracking, but doesn't block on completion.");

  // Create sample tasks
  const tasks = Array.from({ length: 5 }, (_, i) => ({
    id: `task-${String(i)}`,
    data: { value: i * 10 },
  }));

  printSection('Launching background tasks');
  console.log(`  Tasks to launch: ${String(tasks.length)}`);

  const result = await fireAndForgetBatch.run(polos, { tasks });

  printSection('Launch Results');
  console.log(`  Tasks launched: ${String(result['launched'])}`);
  console.log('\n  Execution IDs (for tracking):');
  for (const execId of result['executionIds'] as string[]) {
    console.log(`    - ${execId}`);
  }

  console.log('\n  Note: These tasks are running in the background.');
  console.log('  Use the execution IDs to check their status later.');
}

async function demoParallelComparison(polos: Polos): Promise<void> {
  printHeader('Parallel vs Sequential Comparison');
  console.log('This demo shows the time savings of parallel execution.');

  // Sequential: Run 3 reviews one by one
  printSection('Sequential Execution (3 reviews)');
  let startTime = Date.now();

  for (let i = 0; i < 3; i++) {
    const reviewer = `reviewer${String(i + 1)}`;
    await singleReview.run(polos, {
      reviewerId: reviewer,
      documentId: 'DOC-SEQ',
      content: 'Sequential test document',
    } satisfies ReviewRequest);
    console.log(`  Completed review ${String(i + 1)}`);
  }

  const sequentialTime = (Date.now() - startTime) / 1000;
  console.log(`\n  Sequential time: ${sequentialTime.toFixed(2)} seconds`);

  // Parallel: Run 3 reviews at once
  printSection('Parallel Execution (3 reviews)');
  startTime = Date.now();

  const result = await parallelReview.run(polos, {
    documentId: 'DOC-PAR',
    content: 'Parallel test document',
    reviewers: ['reviewer1', 'reviewer2', 'reviewer3'],
  });
  console.log(`  Completed all ${String(result.totalReviews)} reviews`);

  const parallelTime = (Date.now() - startTime) / 1000;
  console.log(`\n  Parallel time: ${parallelTime.toFixed(2)} seconds`);

  if (sequentialTime > 0 && parallelTime > 0) {
    const speedup = sequentialTime / parallelTime;
    console.log(`\n  Speedup: ${speedup.toFixed(1)}x faster with parallel execution`);
  }
}

async function main(): Promise<void> {
  const polos = new Polos({ deploymentId: 'parallel-review-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    console.log('='.repeat(60));
    console.log('Parallel Review Workflow Examples');
    console.log('='.repeat(60));
    console.log('\nThis demo showcases parallel workflow patterns:');
    console.log('  1. Single review workflow');
    console.log('  2. Parallel multi-reviewer workflow (batchInvokeAndWait)');
    console.log('  3. Data chunk processing (fan-out/fan-in)');
    console.log('  4. Fire-and-forget batch (batchInvoke)');
    console.log('  5. Sequential vs parallel comparison');

    await demoSingleReview(polos);
    await demoParallelReview(polos);
    await demoDataChunkProcessor(polos);
    await demoFireAndForget(polos);
    await demoParallelComparison(polos);

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
