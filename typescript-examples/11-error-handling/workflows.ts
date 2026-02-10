/**
 * Error handling examples for workflows.
 *
 * Demonstrates how to handle errors, retries, and failures in workflows.
 */

import { defineWorkflow } from '@polos/sdk';

// ============================================================================
// Payload / Result Types
// ============================================================================

export interface RetryPayload {
  failureRate: number;
  operation: string;
}

interface RetryResult {
  status: string;
  result: Record<string, unknown>;
}

interface ErrorRecoveryPayload {
  items: string[];
}

interface ErrorRecoveryResult {
  processed: number;
  failed: number;
  results: { item: string; status: string }[];
  errors: { item: string; error: string }[];
}

interface FallbackPayload {
  data: Record<string, unknown>;
}

interface FallbackResult {
  method: string;
  result?: Record<string, unknown>;
  error?: string;
}

interface CircuitBreakerItem {
  id: number;
  name: string;
  shouldFail?: boolean;
}

interface CircuitBreakerPayload {
  items: CircuitBreakerItem[];
  failureThreshold: number;
}

interface CircuitBreakerResult {
  results: { item: CircuitBreakerItem; status: string; reason?: string }[];
  circuitOpen: boolean;
  totalFailures: number;
}

interface CompensationPayload {
  orderId: string;
  failConfirmation?: boolean;
}

interface CompensationResult {
  status: string;
  completed?: string[];
  error?: string;
  compensated?: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

function unreliableOperation(failureRate: number, operation: string): Record<string, unknown> {
  if (Math.random() < failureRate) {
    throw new Error(`Random failure in ${operation}`);
  }
  return { operation, success: true };
}

function processItem(item: string): { item: string; status: string } {
  if (item.toLowerCase().includes('fail')) {
    throw new Error(`Cannot process item: ${item}`);
  }
  return { item, status: 'processed' };
}

function primaryProcess(data: Record<string, unknown>): Record<string, unknown> {
  if (data['force_failure'] ?? data['forceFailure']) {
    throw new Error('Primary method failed');
  }
  return { processed: data, method: 'primary' };
}

function fallbackProcess(data: Record<string, unknown>): Record<string, unknown> {
  return { processed: data, method: 'fallback', degraded: true };
}

function processWithCircuitBreaker(item: CircuitBreakerItem): { item: CircuitBreakerItem; status: string } {
  if (item.shouldFail) {
    throw new Error(`Failed to process: ${item.name}`);
  }
  return { item, status: 'success' };
}

function reserveInventory(_payload: CompensationPayload): Record<string, unknown> {
  return { reserved: true };
}

function chargePayment(_payload: CompensationPayload): Record<string, unknown> {
  return { charged: true };
}

function sendConfirmation(payload: CompensationPayload): Record<string, unknown> {
  if (payload.failConfirmation) {
    throw new Error('Failed to send confirmation');
  }
  return { sent: true };
}

function getCompensation(step: string): ((p: CompensationPayload) => Record<string, unknown>) | undefined {
  const compensations: Record<string, (p: CompensationPayload) => Record<string, unknown>> = {
    reserve_inventory: () => ({ released: true }),
    charge_payment: () => ({ refunded: true }),
  };
  return compensations[step];
}

// ============================================================================
// Retry Example
// ============================================================================

export const retryExample = defineWorkflow<RetryPayload, unknown, RetryResult>(
  { id: 'retry_example' },
  async (ctx, payload) => {
    const result = await ctx.step.run(
      'unreliable_operation',
      () => unreliableOperation(payload.failureRate, payload.operation),
      { maxRetries: 3, baseDelay: 1000, maxDelay: 10000 },
    );

    return { status: 'success', result };
  },
);

// ============================================================================
// Error Recovery
// ============================================================================

export const errorRecovery = defineWorkflow<ErrorRecoveryPayload, unknown, ErrorRecoveryResult>(
  { id: 'error_recovery' },
  async (ctx, payload) => {
    const results: { item: string; status: string }[] = [];
    const errors: { item: string; error: string }[] = [];

    const items = payload.items;

    for (const item of items) {
      try {
        const result = await ctx.step.run(
          `process_${item}`,
          () => processItem(item),
        );
        results.push(result);
      } catch (e) {
        errors.push({
          item,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      processed: results.length,
      failed: errors.length,
      results,
      errors,
    };
  },
);

// ============================================================================
// Fallback Pattern
// ============================================================================

export const fallbackPattern = defineWorkflow<FallbackPayload, unknown, FallbackResult>(
  { id: 'fallback_pattern' },
  async (ctx, payload) => {
    const data = payload.data;

    // Try primary method
    try {
      const result = await ctx.step.run(
        'primary_method',
        () => primaryProcess(data),
        { maxRetries: 2 },
      );
      return { method: 'primary', result };
    } catch {
      // Fall through to fallback
    }

    // Try fallback method
    try {
      const result = await ctx.step.run(
        'fallback_method',
        () => fallbackProcess(data),
        { maxRetries: 2 },
      );
      return { method: 'fallback', result };
    } catch (e) {
      return { method: 'none', error: e instanceof Error ? e.message : String(e) };
    }
  },
);

// ============================================================================
// Circuit Breaker
// ============================================================================

export const circuitBreaker = defineWorkflow<CircuitBreakerPayload, unknown, CircuitBreakerResult>(
  { id: 'circuit_breaker' },
  async (ctx, payload) => {
    const items = payload.items;
    const failureThreshold = payload.failureThreshold;

    const results: CircuitBreakerResult['results'] = [];
    let failures = 0;
    let circuitOpen = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;

      if (circuitOpen) {
        results.push({ item, status: 'skipped', reason: 'circuit_open' });
        continue;
      }

      try {
        const result = await ctx.step.run(
          `process_${String(i)}`,
          () => processWithCircuitBreaker(item),
          { maxRetries: 1 },
        );
        results.push(result);
        failures = 0; // Reset on success
      } catch {
        failures += 1;
        results.push({ item, status: 'failed' });

        if (failures >= failureThreshold) {
          circuitOpen = true;
        }
      }
    }

    return { results, circuitOpen, totalFailures: failures };
  },
);

// ============================================================================
// Compensation Pattern (Saga)
// ============================================================================

export const compensationPattern = defineWorkflow<CompensationPayload, unknown, CompensationResult>(
  { id: 'compensation_pattern' },
  async (ctx, payload) => {
    const completedSteps: string[] = [];

    try {
      await ctx.step.run('reserve_inventory', () => reserveInventory(payload));
      completedSteps.push('reserve_inventory');

      await ctx.step.run('charge_payment', () => chargePayment(payload));
      completedSteps.push('charge_payment');

      await ctx.step.run('send_confirmation', () => sendConfirmation(payload));
      completedSteps.push('send_confirmation');

      return { status: 'success', completed: completedSteps };
    } catch (e) {
      // Run compensation for completed steps in reverse order
      for (const step of [...completedSteps].reverse()) {
        const compensationFn = getCompensation(step);
        if (compensationFn) {
          await ctx.step.run(
            `compensate_${step}`,
            () => compensationFn(payload),
          );
        }
      }

      return {
        status: 'rolled_back',
        error: e instanceof Error ? e.message : String(e),
        compensated: [...completedSteps].reverse(),
      };
    }
  },
);
