/**
 * Basic workflow examples demonstrating defineWorkflow and step operations.
 *
 * Workflows are durable functions that can:
 * - Execute steps that are automatically retried on failure
 * - Wait for time durations or events
 * - Invoke other workflows (child workflows)
 * - Maintain state across executions
 */

import { defineWorkflow } from '@polos/sdk';
import type { WorkflowContext } from '@polos/sdk';

// ============================================================================
// Simple Workflow
// ============================================================================

interface SimplePayload {
  name: string;
}

interface SimpleResult {
  message: string;
}

export const simpleWorkflow = defineWorkflow<SimplePayload, unknown, SimpleResult>(
  { id: 'simple_workflow' },
  async (ctx, payload) => {
    // Use ctx.step.run to execute a step with automatic retry
    const greeting = await ctx.step.run(
      'generate_greeting', // Step key - must be unique
      () => `Hello, ${payload.name}!`, // Function to execute
    );

    return { message: greeting };
  },
);

// ============================================================================
// Order Processing Workflow
// ============================================================================

interface OrderPayload {
  orderId: string;
  customerEmail: string;
  items: string[];
  totalAmount: number;
}

interface OrderResult {
  orderId: string;
  status: string;
  confirmationNumber: string;
}

export const processOrder = defineWorkflow<OrderPayload, unknown, OrderResult>(
  { id: 'order_processor' },
  async (ctx, payload) => {
    // Step 1: Validate order
    await ctx.step.run('validate_order', () => {
      if (payload.items.length === 0) {
        throw new Error('Order must have at least one item');
      }
      if (payload.totalAmount <= 0) {
        throw new Error('Total amount must be positive');
      }
      return true;
    });

    // Step 2: Reserve inventory
    await ctx.step.run('reserve_inventory', () => ({
      reserved: payload.items,
      status: 'reserved',
    }));

    // Step 3: Process payment
    await ctx.step.run('process_payment', () => ({
      amount: payload.totalAmount,
      status: 'paid',
    }));

    // Step 4: Generate confirmation number (deterministic via step)
    const confirmation = await ctx.step.uuid('confirmation_number');

    // Step 5: Send confirmation email
    await ctx.step.run('send_confirmation', () => ({
      email: payload.customerEmail,
      confirmation,
      sent: true,
    }));

    return {
      orderId: payload.orderId,
      status: 'completed',
      confirmationNumber: confirmation,
    };
  },
);

// ============================================================================
// Data Pipeline Workflow
// ============================================================================

interface DataPipelinePayload {
  data: (string | number)[];
}

interface AggregatedData {
  count: number;
  items: (string | number)[];
}

interface DataPipelineResult {
  result: AggregatedData;
}

export const dataPipeline = defineWorkflow<DataPipelinePayload, unknown, DataPipelineResult>(
  { id: 'data_pipeline' },
  async (ctx, payload) => {
    // Step with custom retry settings
    const processed = await ctx.step.run(
      'process_data',
      () =>
        payload.data.map((item) =>
          typeof item === 'string' ? item.toUpperCase() : item * 2,
        ),
      {
        maxRetries: 5, // More retries for unreliable operations
        baseDelay: 2000, // Longer delay between retries (ms)
        maxDelay: 30000, // Cap on exponential backoff (ms)
      },
    );

    // Aggregate results
    const aggregated = await ctx.step.run('aggregate_results', () => ({
      count: processed.length,
      items: processed,
    }));

    return { result: aggregated };
  },
);

// ============================================================================
// Timed Workflow
// ============================================================================

interface TimedResult {
  status: string;
  startTime: number;
  endTime: number;
  durationMs: number;
}

export const timedWorkflow = defineWorkflow<Record<string, never>, unknown, TimedResult>(
  { id: 'timed_workflow' },
  async (ctx) => {
    // Get current timestamp (deterministic via step)
    const startTime = await ctx.step.now('start_time');

    // Simulate some work
    await ctx.step.run('initial_work', () => ({ status: 'processing' }));

    // Wait for a short duration (useful for rate limiting, etc.)
    await ctx.step.waitFor('cooldown', { seconds: 5 });

    // Do more work after waiting
    const finalStatus = await ctx.step.run('final_work', () => 'completed');

    const endTime = await ctx.step.now('end_time');

    return {
      status: finalStatus,
      startTime,
      endTime,
      durationMs: endTime - startTime,
    };
  },
);

// ============================================================================
// Random Workflow
// ============================================================================

interface RandomResult {
  randomValue: number;
  randomId: string;
  coinFlip: string;
}

export const randomWorkflow = defineWorkflow<Record<string, never>, unknown, RandomResult>(
  { id: 'random_workflow' },
  async (ctx) => {
    // Generate random values (deterministic across replays)
    const randomValue = await ctx.step.random('random_value');
    const randomId = await ctx.step.uuid('random_id');

    // Use random value for decision making
    const coinFlip = randomValue > 0.5 ? 'heads' : 'tails';

    return { randomValue, randomId, coinFlip };
  },
);

// ============================================================================
// Child Workflow Examples
// ============================================================================

interface ValidateEnrichPayload {
  data: Record<string, unknown>;
  validationType?: string;
}

interface ValidateEnrichResult {
  valid: boolean;
  original?: Record<string, unknown>;
  enriched?: Record<string, unknown>;
  timestamp?: number;
  error?: string;
}

export const validateAndEnrich = defineWorkflow<
  ValidateEnrichPayload,
  unknown,
  ValidateEnrichResult
>(
  { id: 'validate_and_enrich' },
  async (ctx, payload) => {
    const validationType = payload.validationType ?? 'basic';

    // Step 1: Validate the data
    const isValid = await ctx.step.run('validate_data', () => {
      if (validationType === 'strict') {
        return Boolean(
          payload.data &&
            Object.keys(payload.data).length > 0 &&
            Object.values(payload.data).every((v) => v !== null && v !== undefined),
        );
      }
      return Boolean(payload.data && Object.keys(payload.data).length > 0);
    });

    if (!isValid) {
      return {
        valid: false,
        original: payload.data,
        error: 'Validation failed',
      };
    }

    // Step 2: Enrich the data with additional info
    const enriched = await ctx.step.run('enrich_data', () => ({
      ...payload.data,
      _enriched: true,
      _source: 'validate_and_enrich_workflow',
    }));

    // Step 3: Add timestamp
    const timestamp = await ctx.step.now('enrichment_timestamp');

    return {
      valid: true,
      original: payload.data,
      enriched,
      timestamp,
    };
  },
);

// ============================================================================
// Parent Workflow (invokes child workflows)
// ============================================================================

interface ItemData {
  id: number;
  name: string;
  value: number;
}

interface PreparationStatus {
  status: string;
  itemCount: number;
}

interface ParentPayload {
  items: ItemData[];
}

interface ParentResult {
  preparation: PreparationStatus;
  totalItems: number;
  validItems: number;
  results: ValidateEnrichResult[];
}

export const parentWorkflow = defineWorkflow<ParentPayload, unknown, ParentResult>(
  { id: 'parent_workflow' },
  async (ctx, payload) => {
    const results: ValidateEnrichResult[] = [];

    // Step 1: Do some initial work
    const preparation = await ctx.step.run('prepare_data', () => ({
      status: 'prepared',
      itemCount: payload.items.length,
    }));

    // Step 2: Invoke child workflow for each item and wait for results
    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i]!;
      // Invoke child workflow and wait for it to complete
      const childResult = await ctx.step.invokeAndWait<
        ValidateEnrichPayload,
        ValidateEnrichResult
      >(
        `validate_item_${String(i)}`,
        validateAndEnrich,
        {
          data: { id: item.id, name: item.name, value: item.value },
          validationType: 'basic',
        },
      );
      results.push(childResult);
    }

    // Step 3: Aggregate results
    const validCount = results.filter((r) => r.valid).length;

    return {
      preparation,
      totalItems: payload.items.length,
      validItems: validCount,
      results,
    };
  },
);

// ============================================================================
// Orchestrator Workflow (sequential child workflow calls)
// ============================================================================

interface OrchestratorPayload {
  data: Record<string, unknown>;
}

interface ProcessedData {
  processed: boolean;
  data: Record<string, unknown>;
  processingApplied: string[];
}

interface OrchestratorResult {
  status: string;
  outputId?: string;
  stage?: string;
  error?: string;
  enrichment?: ValidateEnrichResult;
  processed?: ProcessedData;
}

export const orchestratorWorkflow = defineWorkflow<
  OrchestratorPayload,
  unknown,
  OrchestratorResult
>(
  { id: 'orchestrator_workflow' },
  async (ctx, payload) => {
    // Step 1: First, validate and enrich the data using child workflow
    const enrichmentResult = await ctx.step.invokeAndWait<
      ValidateEnrichPayload,
      ValidateEnrichResult
    >(
      'enrich_data',
      validateAndEnrich,
      { data: payload.data, validationType: 'strict' },
    );

    if (!enrichmentResult.valid) {
      return {
        status: 'failed',
        stage: 'enrichment',
        error: enrichmentResult.error,
      };
    }

    // Step 2: Process the enriched data
    const processed = await ctx.step.run('process_enriched', (): ProcessedData => ({
      processed: true,
      data: enrichmentResult.enriched ?? {},
      processingApplied: ['normalize', 'dedupe'],
    }));

    // Step 3: Generate final output
    const outputId = await ctx.step.uuid('output_id');

    return {
      status: 'completed',
      outputId,
      enrichment: enrichmentResult,
      processed,
    };
  },
);
