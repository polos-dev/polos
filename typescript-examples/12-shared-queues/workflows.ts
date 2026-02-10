/**
 * Shared queue examples.
 *
 * Demonstrates how to use queues to control concurrency across workflows.
 * Queues limit how many workflows can run simultaneously, preventing
 * resource exhaustion and rate limiting issues.
 */

import { defineWorkflow, Queue } from '@polos/sdk';

// ============================================================================
// Shared Queues
// ============================================================================

// Queue for API calls — limit to 5 concurrent requests
const apiQueue = new Queue('api-calls', { concurrencyLimit: 5 });

// Queue for database operations — limit to 10 concurrent
const dbQueue = new Queue('database-ops', { concurrencyLimit: 10 });

// Queue for heavy processing — limit to 2 concurrent
const heavyQueue = new Queue('heavy-processing', { concurrencyLimit: 2 });

// ============================================================================
// Payload / Result Types
// ============================================================================

export interface ApiPayload {
  url: string;
  method?: string;
  data?: Record<string, unknown>;
}

interface ApiResult {
  url: string;
  method: string;
  result: { status: number; response: Record<string, unknown> };
}

interface DbReadPayload {
  table: string;
  query?: Record<string, unknown>;
}

interface DbWritePayload {
  table: string;
  data: Record<string, unknown>;
}

export interface SlowWorkflowPayload {
  workflowId: number;
  sleepSeconds?: number;
}

interface SlowWorkflowResult {
  workflowId: number;
  message: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function makeApiRequest(_url: string, _method: string, _data: Record<string, unknown> | undefined): { status: number; response: Record<string, unknown> } {
  // In a real scenario, this would make an HTTP request
  return { status: 200, response: { message: 'Success' } };
}

function executeDbQuery(_table: string, _query: Record<string, unknown>): Record<string, unknown>[] {
  return [{ id: 1, name: 'Example' }];
}

function insertDbData(_table: string, data: Record<string, unknown>): Record<string, unknown> {
  return { id: 1, ...data };
}

function heavyProcess(data: unknown[]): Record<string, unknown> {
  // In a real scenario, this would do CPU-intensive work
  return { itemsProcessed: data.length, status: 'complete' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// API Call Workflow (uses api-calls queue)
// ============================================================================

export const apiCallWorkflow = defineWorkflow<ApiPayload, unknown, ApiResult>(
  { id: 'api_call', queue: apiQueue },
  async (ctx, payload) => {
    const method = payload.method ?? 'GET';

    const result = await ctx.step.run(
      'make_request',
      () => makeApiRequest(payload.url, method, payload.data),
    );

    return { url: payload.url, method, result };
  },
);

// ============================================================================
// Database Read Workflow (uses database-ops queue)
// ============================================================================

export const dbReadWorkflow = defineWorkflow<DbReadPayload, unknown, Record<string, unknown>>(
  { id: 'db_read', queue: dbQueue },
  async (ctx, payload) => {
    const table = payload.table;
    const query = payload.query ?? {};

    const results = await ctx.step.run(
      'execute_query',
      () => executeDbQuery(table, query),
    );

    return { table, results };
  },
);

// ============================================================================
// Database Write Workflow (shares database-ops queue with db_read)
// ============================================================================

export const dbWriteWorkflow = defineWorkflow<DbWritePayload, unknown, Record<string, unknown>>(
  { id: 'db_write', queue: dbQueue },
  async (ctx, payload) => {
    const table = payload.table;
    const data = payload.data;

    const inserted = await ctx.step.run(
      'insert_data',
      () => insertDbData(table, data),
    );

    return { table, inserted };
  },
);

// ============================================================================
// Heavy Processing Workflow (uses heavy-processing queue)
// ============================================================================

export const heavyProcessingWorkflow = defineWorkflow<Record<string, unknown>, unknown, Record<string, unknown>>(
  { id: 'heavy_processing', queue: heavyQueue },
  async (ctx, payload) => {
    const data = (payload['data'] as unknown[]) ?? [];

    const processed = await ctx.step.run(
      'process_data',
      () => heavyProcess(data),
    );

    return { processed };
  },
);

// ============================================================================
// Inline Queue Configuration
// ============================================================================

export const inlineQueueWorkflow = defineWorkflow<Record<string, unknown>, unknown, Record<string, unknown>>(
  { id: 'inline_queue_workflow', queue: { name: 'inline_queue_workflow', concurrencyLimit: 3 } },
  async () => {
    return { message: 'Processed with inline queue' };
  },
);

// ============================================================================
// Named Queue
// ============================================================================

export const namedQueueWorkflow = defineWorkflow<Record<string, unknown>, unknown, Record<string, unknown>>(
  { id: 'named_queue_workflow', queue: 'my-named-queue' },
  async () => {
    return { message: 'Processed with named queue' };
  },
);

// ============================================================================
// Batch Processor (shares api-calls queue with api_call)
// ============================================================================

export const batchProcessor = defineWorkflow<Record<string, unknown>, unknown, Record<string, unknown>>(
  { id: 'batch_processor', queue: apiQueue },
  async (ctx, payload) => {
    const items = (payload['items'] as Record<string, unknown>[]) ?? [];
    const results: Record<string, unknown>[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const result = await ctx.step.run(
        `process_item_${String(i)}`,
        () => makeApiRequest((item['url'] as string) ?? '', 'GET', undefined),
      );
      results.push(result);
    }

    return { processed: results.length, results };
  },
);

// ============================================================================
// Queue Orchestrator (invokes workflows on different queues)
// ============================================================================

export const queueOrchestrator = defineWorkflow<Record<string, unknown>, unknown, Record<string, unknown>>(
  { id: 'queue_orchestrator' },
  async (ctx) => {
    const apiHandle = await ctx.step.invoke(
      'invoke_api',
      apiCallWorkflow,
      { url: 'https://api.example.com/data' },
    );

    const dbHandle = await ctx.step.invoke(
      'invoke_db',
      dbReadWorkflow,
      { table: 'users', query: { active: true } },
    );

    const heavyHandle = await ctx.step.invoke(
      'invoke_heavy',
      heavyProcessingWorkflow,
      { data: [1, 2, 3, 4, 5] },
    );

    return {
      apiExecutionId: apiHandle.executionId,
      dbExecutionId: dbHandle.executionId,
      heavyExecutionId: heavyHandle.executionId,
    };
  },
);

// ============================================================================
// Slow Workflow (for demonstrating runtime concurrency)
// ============================================================================

export const slowWorkflow = defineWorkflow<SlowWorkflowPayload, unknown, SlowWorkflowResult>(
  { id: 'slow_workflow' },
  async (_ctx, payload) => {
    const sleepSeconds = payload.sleepSeconds ?? 2.0;

    console.log(`  [Workflow ${String(payload.workflowId)}] Started!`);

    await sleep(sleepSeconds * 1000);

    console.log(`  [Workflow ${String(payload.workflowId)}] Completed!`);

    return {
      workflowId: payload.workflowId,
      message: `Workflow ${String(payload.workflowId)} finished after ${String(sleepSeconds)}s`,
    };
  },
);
