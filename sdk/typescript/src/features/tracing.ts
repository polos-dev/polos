/**
 * OpenTelemetry tracing support for Polos workflows.
 */

import { randomBytes } from 'node:crypto';
import {
  type Context,
  type Span,
  type SpanContext,
  type TextMapGetter,
  type TextMapSetter,
  type Tracer,
  SpanStatusCode,
  context,
  trace,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type IdGenerator,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { type ExportResult, W3CTraceContextPropagator } from '@opentelemetry/core';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ name: 'tracing' });

// Re-export types that consumers need
export { type Span, type SpanContext, type Context, SpanStatusCode };

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _tracerProvider: BasicTracerProvider | undefined;
let _tracer: Tracer | undefined;
let _propagator: W3CTraceContextPropagator | undefined;
let _initialized = false;

// ---------------------------------------------------------------------------
// Propagator
// ---------------------------------------------------------------------------

/**
 * Get the W3C trace context propagator (lazy singleton).
 */
function getPropagator(): W3CTraceContextPropagator {
  _propagator ??= new W3CTraceContextPropagator();
  return _propagator;
}

/**
 * Simple carrier getter for extracting traceparent from a plain object.
 */
const mapGetter: TextMapGetter<Record<string, string>> = {
  get(carrier, key) {
    return carrier[key];
  },
  keys(carrier) {
    return Object.keys(carrier);
  },
};

/**
 * Simple carrier setter for injecting traceparent into a plain object.
 */
const mapSetter: TextMapSetter<Record<string, string>> = {
  set(carrier, key, value) {
    carrier[key] = value;
  },
};

// ---------------------------------------------------------------------------
// DatabaseSpanExporter
// ---------------------------------------------------------------------------

/**
 * Configuration for initializing OpenTelemetry.
 */
export interface OtelConfig {
  apiUrl: string;
  apiKey: string;
  projectId: string;
}

/**
 * Custom span exporter that stores spans to the database via the orchestrator API.
 */
class DatabaseSpanExporter implements SpanExporter {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly projectId: string;

  constructor(config: OtelConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (spans.length === 0) {
      resultCallback({ code: 0 }); // SUCCESS
      return;
    }

    const spanDataList = spans.map((span) => this.spanToDict(span));
    const url = `${this.apiUrl}/internal/spans/batch`;

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-Project-ID': this.projectId,
      },
      body: JSON.stringify({ spans: spanDataList }),
    })
      .then((response) => {
        if (!response.ok) {
          logger.warn(`Failed to export spans: HTTP ${String(response.status)}`);
          resultCallback({ code: 1 }); // FAILURE
        } else {
          resultCallback({ code: 0 }); // SUCCESS
        }
      })
      .catch((err: unknown) => {
        logger.warn(`Failed to export spans: ${String(err)}`);
        resultCallback({ code: 1 }); // FAILURE
      });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Convert a ReadableSpan to the database dict format/
   */
  private spanToDict(span: ReadableSpan): Record<string, unknown> {
    const spanCtx = span.spanContext();
    const traceId = spanCtx.traceId;
    const spanId = spanCtx.spanId;

    // Parent span ID
    let parentSpanId: string | null = null;
    if (span.parentSpanId) {
      parentSpanId = span.parentSpanId;
    }

    // Extract attributes, separating input/output/error/state
    const attributes: Record<string, string | null> = {};
    let inputData: unknown = null;
    let outputData: unknown = null;
    let initialState: unknown = null;
    let finalState: unknown = null;
    let errorFromAttributes: unknown = null;

    for (const [key, value] of Object.entries(span.attributes)) {
      if (INPUT_KEYS.has(key) && value != null) {
        inputData = tryParseJson(value);
      } else if (OUTPUT_KEYS.has(key) && value != null) {
        outputData = tryParseJson(value);
      } else if (ERROR_KEYS.has(key) && value != null) {
        errorFromAttributes = tryParseJson(value);
      } else if (INITIAL_STATE_KEYS.has(key) && value != null) {
        initialState = tryParseJson(value);
      } else if (FINAL_STATE_KEYS.has(key) && value != null) {
        finalState = tryParseJson(value);
      } else {
        attributes[key] = value != null ? String(value) : null;
      }
    }

    // Extract events
    const eventsData: Record<string, unknown>[] = [];
    for (const event of span.events) {
      const eventName = event.name;
      const eventTimestamp = formatHrTime(event.time);

      const eventAttributes: Record<string, string | null> = {};
      if (event.attributes) {
        for (const [key, value] of Object.entries(event.attributes)) {
          eventAttributes[key] = value != null ? String(value) : null;
        }
      }

      eventsData.push({
        name: eventName,
        timestamp: eventTimestamp,
        attributes: Object.keys(eventAttributes).length > 0 ? eventAttributes : null,
      });
    }

    // Status and error
    let errorData: unknown = null;
    if (errorFromAttributes) {
      errorData = errorFromAttributes;
    } else if (span.status.code === SpanStatusCode.ERROR) {
      errorData = {
        message: span.status.message ?? 'Unknown error',
        error_type: 'Error',
      };
    }

    // Timestamps
    const startedAt = formatHrTime(span.startTime);
    const endedAt = formatHrTime(span.endTime);

    // Span type
    let spanType = 'custom';
    const name = span.name;
    if (name.startsWith('workflow.')) {
      spanType = 'workflow';
    } else if (name.startsWith('agent.')) {
      spanType = 'agent';
    } else if (name.startsWith('tool.')) {
      spanType = 'tool';
    } else if (name.startsWith('step.')) {
      spanType = 'step';
    } else if (attributes['span_type']) {
      spanType = attributes['span_type'];
    }

    return {
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
      name,
      span_type: spanType,
      attributes: Object.keys(attributes).length > 0 ? attributes : null,
      events: eventsData.length > 0 ? eventsData : null,
      input: inputData,
      output: outputData,
      error: errorData,
      initial_state: initialState,
      final_state: finalState,
      started_at: startedAt,
      ended_at: endedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Span attribute key sets
// ---------------------------------------------------------------------------

const INPUT_KEYS = new Set([
  'step.input',
  'workflow.input',
  'agent.input',
  'tool.input',
  'llm.input',
]);
const OUTPUT_KEYS = new Set([
  'step.output',
  'workflow.output',
  'agent.output',
  'tool.output',
  'llm.output',
]);
const ERROR_KEYS = new Set([
  'step.error',
  'workflow.error',
  'agent.error',
  'tool.error',
  'llm.error',
]);
const INITIAL_STATE_KEYS = new Set([
  'workflow.initial_state',
  'agent.initial_state',
  'tool.initial_state',
]);
const FINAL_STATE_KEYS = new Set(['workflow.final_state', 'agent.final_state', 'tool.final_state']);

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Format OTel HrTime ([seconds, nanoseconds]) to ISO string.
 */
function formatHrTime(hrTime: unknown): string | null {
  if (hrTime == null) return null;
  if (Array.isArray(hrTime) && hrTime.length === 2) {
    const ms = (hrTime[0] as number) * 1000 + (hrTime[1] as number) / 1e6;
    return new Date(ms).toISOString();
  }
  if (typeof hrTime === 'number') {
    if (hrTime > 1e15) {
      return new Date(hrTime / 1e6).toISOString();
    }
    return new Date(hrTime).toISOString();
  }
  return null;
}

// ---------------------------------------------------------------------------
// DeterministicTraceIdGenerator
// ---------------------------------------------------------------------------

const TRACE_ID_SYMBOL = Symbol.for('polos.trace_id');

/**
 * ID generator that uses deterministic trace IDs from context when available.
 * Falls back to random IDs.
 */
class DeterministicTraceIdGenerator implements IdGenerator {
  generateTraceId(): string {
    // Check active OTel context for deterministic trace ID
    try {
      const currentContext = context.active();
      const deterministicId = currentContext.getValue(TRACE_ID_SYMBOL);
      if (typeof deterministicId === 'string') {
        return deterministicId;
      }
    } catch {
      // fall through to random
    }
    return randomHex(32);
  }

  generateSpanId(): string {
    return randomHex(16);
  }
}

function randomHex(length: number): string {
  return randomBytes(length / 2).toString('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize OpenTelemetry with database exporter.
 */
export function initializeOtel(config: OtelConfig): void {
  if (_initialized) return;

  try {
    // Check if enabled
    if (process.env['POLOS_OTEL_ENABLED']?.toLowerCase() === 'false') {
      logger.info('OpenTelemetry disabled via POLOS_OTEL_ENABLED=false');
      return;
    }

    // Create tracer provider with deterministic ID generator and database exporter
    const dbExporter = new DatabaseSpanExporter(config);
    _tracerProvider = new BasicTracerProvider({
      idGenerator: new DeterministicTraceIdGenerator(),
      spanProcessors: [new BatchSpanProcessor(dbExporter)],
    });

    // Register as global with AsyncLocalStorage context manager
    // Required for DeterministicTraceIdGenerator to read trace ID from context
    _tracerProvider.register({
      contextManager: new AsyncLocalStorageContextManager(),
    });

    // Get tracer
    const serviceName = process.env['POLOS_OTEL_SERVICE_NAME'] ?? 'polos';
    _tracer = trace.getTracer(serviceName);
    _initialized = true;

    logger.info('OpenTelemetry initialized with database exporter');
  } catch (e) {
    logger.warn(`Failed to initialize OpenTelemetry: ${String(e)}. Tracing disabled.`);
    _tracer = undefined;
  }
}

/**
 * Get the tracer instance. Returns undefined if OTel is not initialized.
 */
export function getTracer(): Tracer | undefined {
  return _tracer;
}

/**
 * Flush pending spans and shut down the OpenTelemetry tracer provider.
 *
 * Must be called during worker shutdown before the process exits so that
 * the BatchSpanProcessor exports any remaining spans.
 */
export async function shutdownOtel(): Promise<void> {
  if (!_tracerProvider) return;

  try {
    await _tracerProvider.forceFlush();
    await _tracerProvider.shutdown();
  } catch (e) {
    logger.warn(`Error during OpenTelemetry shutdown: ${String(e)}`);
  } finally {
    _tracerProvider = undefined;
    _tracer = undefined;
    _initialized = false;
  }
}

/**
 * Get the current span from OTel context.
 */
export function getCurrentSpan(): Span | undefined {
  return trace.getSpan(context.active());
}

/**
 * Extract traceparent string from a span using W3C propagator.
 */
export function extractTraceparent(span: Span): string | undefined {
  try {
    const prop = getPropagator();
    const carrier: Record<string, string> = {};

    // Create a context with the span and inject traceparent into carrier
    const ctx = trace.setSpan(context.active(), span);
    prop.inject(ctx, carrier, mapSetter);

    return carrier['traceparent'] ?? undefined;
  } catch (e) {
    logger.warn(`Failed to extract traceparent: ${String(e)}`);
    return undefined;
  }
}

/**
 * Create OTel context from a W3C traceparent string (for sub-workflows).
 */
export function createContextFromTraceparent(traceparent: string): Context | undefined {
  if (!traceparent) return undefined;

  try {
    const prop = getPropagator();
    const carrier: Record<string, string> = { traceparent };
    const extractedContext = prop.extract(context.active(), carrier, mapGetter);

    return extractedContext;
  } catch (e) {
    logger.warn(`Failed to create context from traceparent '${traceparent}': ${String(e)}`);
    return undefined;
  }
}

/**
 * Create OTel context with a deterministic trace ID (for root workflows).
 * The DeterministicTraceIdGenerator reads this from the context.
 */
export function createContextWithTraceId(traceIdHex: string): Context | undefined {
  try {
    const ctx = context.active();
    return ctx.setValue(TRACE_ID_SYMBOL, traceIdHex);
  } catch (e) {
    logger.warn(`Failed to create context with trace ID: ${String(e)}`);
    return undefined;
  }
}

/**
 * Generate a deterministic trace ID (32-char hex) from a UUID execution ID.
 */
export function generateTraceIdFromExecutionId(executionId: string): string {
  const hexStr = executionId.replace(/-/g, '');
  if (hexStr.length !== 32) {
    throw new Error(`Invalid execution_id format: ${executionId}`);
  }
  return hexStr;
}

/**
 * Format a Date to ISO string.
 */
export function formatTimestamp(date: Date): string {
  return date.toISOString();
}

/**
 * Check if OpenTelemetry has been initialized.
 */
export function isOtelAvailable(): boolean {
  return _initialized;
}
