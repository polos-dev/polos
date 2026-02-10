/**
 * Span context utilities for ExecutionContextData.
 *
 * Matches Python's utils/tracing.py. Manages the integration between
 * Polos execution context (AsyncLocalStorage) and OTel span contexts.
 */

import { type Context, type SpanContext, trace, context as otelContext } from '@opentelemetry/api';
import type { ExecutionContextData } from '../runtime/execution-context.js';

/**
 * Get parent OTel context from execution context.
 * Wraps the stored SpanContext in a NonRecordingSpan and sets it in an OTel Context,
 * suitable for passing as `context` to `tracer.startSpan(name, opts, context)`.
 */
export function getParentSpanContextFromExecutionContext(
  execContext: ExecutionContextData | undefined
): Context | undefined {
  if (!execContext) return undefined;

  const parentSpanContext = execContext._otelSpanContext as SpanContext | undefined;
  if (!parentSpanContext) return undefined;

  // Wrap SpanContext in NonRecordingSpan → set in OTel Context
  const parentSpan = trace.wrapSpanContext(parentSpanContext);
  return trace.setSpan(otelContext.active(), parentSpan);
}

/**
 * Get raw span context from execution context.
 */
export function getSpanContextFromExecutionContext(
  execContext: ExecutionContextData | undefined
): SpanContext | undefined {
  if (!execContext) return undefined;
  return execContext._otelSpanContext as SpanContext | undefined;
}

/**
 * Store span context in execution context along with formatted trace ID and span ID.
 */
export function setSpanContextInExecutionContext(
  execContext: ExecutionContextData | undefined,
  spanContext: SpanContext | undefined
): void {
  if (!execContext) return;

  execContext._otelSpanContext = spanContext;
  if (spanContext != null) {
    execContext._otelTraceId = spanContext.traceId;
    execContext._otelSpanId = spanContext.spanId;
  }
}
