"""OpenTelemetry tracing support for Polos workflows."""

import asyncio
import json
import logging
import os
import threading
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

import httpx

from ..utils.client_context import get_client_or_raise

try:
    from opentelemetry import context, trace
    from opentelemetry.sdk.trace import RandomIdGenerator, ReadableSpan, TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter, SpanExportResult
    from opentelemetry.trace import SpanKind, Status, StatusCode
    from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
    from opentelemetry.trace.span import Span

    OTELEMETRY_AVAILABLE = True
except ImportError:
    OTELEMETRY_AVAILABLE = False

    # Create no-op types for when OpenTelemetry is not available
    class Span:
        pass

    class Status:
        pass

    class StatusCode:
        OK = "OK"
        ERROR = "ERROR"

    SpanKind = None
    SpanExporter = None
    SpanExportResult = None
    ReadableSpan = None

logger = logging.getLogger(__name__)

# Global state
_tracer_provider = None
_tracer = None
_propagator = None


def get_tracer():
    """Get or create the OpenTelemetry tracer instance."""
    global _tracer
    if _tracer is None:
        initialize_otel()
    return _tracer


def get_propagator():
    """Get the trace context propagator."""
    global _propagator
    if not OTELEMETRY_AVAILABLE:
        return None
    if _propagator is None:
        _propagator = TraceContextTextMapPropagator()
    return _propagator


if OTELEMETRY_AVAILABLE:

    class DatabaseSpanExporter(SpanExporter):
        """Custom span exporter that stores spans directly to database in batches.

        Uses a dedicated event loop in a background thread to handle async operations
        safely from the BatchSpanProcessor's thread.
        """

        def __init__(self):
            """Initialize exporter with dedicated event loop."""
            # Dedicated event loop for this exporter (runs in background thread)
            self.loop = None
            self.loop_thread = None
            self._loop_ready = threading.Event()
            self._start_event_loop()

        def _start_event_loop(self):
            """Start dedicated event loop in background thread."""

            def run_event_loop():
                """Run event loop in background thread."""
                self.loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self.loop)
                self._loop_ready.set()
                self.loop.run_forever()

            self.loop_thread = threading.Thread(
                target=run_event_loop, daemon=True, name="span-exporter-loop"
            )
            self.loop_thread.start()
            # Wait for loop to be ready
            self._loop_ready.wait(timeout=5)

        def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
            """Export spans to database in a batch.

            Args:
                spans: Sequence of OpenTelemetry spans to export

            Returns:
                SpanExportResult.SUCCESS or SpanExportResult.FAILURE
            """
            if not spans or not self.loop:
                return SpanExportResult.SUCCESS

            try:
                # Convert spans to database format
                span_data_list = [self._span_to_dict(span) for span in spans]

                # Schedule coroutine in dedicated event loop and wait for completion
                future = asyncio.run_coroutine_threadsafe(
                    self._store_spans_batch(span_data_list), self.loop
                )

                # Wait for completion with timeout (30 seconds)
                try:
                    future.result(timeout=30)
                    return SpanExportResult.SUCCESS
                except TimeoutError:
                    logger.error("Span export timed out after 30 seconds")
                    return SpanExportResult.FAILURE
                except Exception as e:
                    logger.error(f"Span export failed: {e}")
                    return SpanExportResult.FAILURE

            except Exception as e:
                logger.warning(f"Failed to export spans: {e}")
                return SpanExportResult.FAILURE

        def _span_to_dict(self, span) -> dict[str, Any]:
            """Convert OpenTelemetry span to database format.

            Args:
                span: OpenTelemetry span object

            Returns:
                Dictionary with span data in database format
            """
            span_context = span.get_span_context()
            trace_id = format(span_context.trace_id, "032x") if span_context else None
            span_id = format(span_context.span_id, "016x") if span_context else None

            # Get parent span ID from span's parent context
            # OpenTelemetry SDK spans have a parent_span_id in their context
            parent_span_id = None
            try:
                # Check if span has parent context
                if hasattr(span, "parent") and span.parent:
                    parent_ctx = span.parent
                    # Parent context may have span_id attribute
                    if hasattr(parent_ctx, "span_id"):
                        parent_span_id = format(parent_ctx.span_id, "016x")
                    # Or it might be in the span context
                    elif hasattr(parent_ctx, "span_context"):
                        parent_span_context = parent_ctx.span_context()
                        if parent_span_context and parent_span_context.is_valid:
                            parent_span_id = format(parent_span_context.span_id, "016x")
            except Exception:
                # If we can't extract parent, that's okay - it might be a root span
                pass

            # Extract attributes
            attributes = {}
            input_data = None
            output_data = None
            initial_state = None
            final_state = None
            error_from_attributes = None

            if hasattr(span, "attributes"):
                for key, value in span.attributes.items():
                    # Check for input/output/error in attributes (stored as JSON strings)
                    if (
                        key
                        in (
                            "step.input",
                            "workflow.input",
                            "agent.input",
                            "tool.input",
                            "llm.input",
                        )
                        and value is not None
                    ):
                        # Input is stored as JSON string - parse it
                        try:
                            input_data = json.loads(value)
                        except (json.JSONDecodeError, TypeError):
                            # If parsing fails, store as None
                            input_data = None
                    elif (
                        key
                        in (
                            "step.output",
                            "workflow.output",
                            "agent.output",
                            "tool.output",
                            "llm.output",
                        )
                        and value is not None
                    ):
                        # Output is stored as JSON string - parse it
                        try:
                            output_data = json.loads(value)
                        except (json.JSONDecodeError, TypeError):
                            # If parsing fails, store as None
                            output_data = None
                    elif (
                        key
                        in (
                            "step.error",
                            "workflow.error",
                            "agent.error",
                            "tool.error",
                            "llm.error",
                        )
                        and value is not None
                    ):
                        # Error is stored as JSON string - parse it
                        try:
                            error_from_attributes = json.loads(value)
                        except (json.JSONDecodeError, TypeError):
                            # If parsing fails, store as None
                            error_from_attributes = None
                    elif (
                        key
                        in ("workflow.initial_state", "agent.initial_state", "tool.initial_state")
                        and value is not None
                    ):
                        # State is stored as JSON string - parse it
                        try:
                            initial_state = json.loads(value)
                        except (json.JSONDecodeError, TypeError):
                            # If parsing fails, store as None
                            initial_state = None
                    elif (
                        key in ("workflow.final_state", "agent.final_state", "tool.final_state")
                        and value is not None
                    ):
                        # State is stored as JSON string - parse it
                        try:
                            final_state = json.loads(value)
                        except (json.JSONDecodeError, TypeError):
                            # If parsing fails, store as None
                            final_state = None
                    else:
                        # Store remaining attributes
                        attributes[key] = str(value) if value is not None else None

            # Extract events from span
            events_data = []
            if hasattr(span, "events") and span.events:
                for event in span.events:
                    # Extract event name and timestamp
                    event_name = event.name if hasattr(event, "name") else str(event)
                    event_timestamp = None
                    if hasattr(event, "timestamp"):
                        event_timestamp = format_timestamp(
                            datetime.fromtimestamp(event.timestamp / 1e9, tz=timezone.utc)
                        )

                    # Extract event attributes if any
                    event_attributes = {}
                    if hasattr(event, "attributes") and event.attributes:
                        for key, value in event.attributes.items():
                            event_attributes[key] = str(value) if value is not None else None

                    events_data.append(
                        {
                            "name": event_name,
                            "timestamp": event_timestamp,
                            "attributes": event_attributes if event_attributes else None,
                        }
                    )

            # Get status and error
            status = span.status
            error_data = None
            # Prefer error from attributes if available (more detailed)
            if error_from_attributes:
                error_data = error_from_attributes
            elif status and status.status_code == StatusCode.ERROR:
                error_data = {
                    "message": status.description or "Unknown error",
                    "error_type": "Error",
                }

            # Extract start/end times
            started_at = format_timestamp(
                datetime.fromtimestamp(span.start_time / 1e9, tz=timezone.utc)
            )
            ended_at = None
            if span.end_time:
                ended_at = format_timestamp(
                    datetime.fromtimestamp(span.end_time / 1e9, tz=timezone.utc)
                )

            # Determine span type from name
            span_type = "custom"
            if span.name.startswith("workflow."):
                span_type = "workflow"
            elif span.name.startswith("agent."):
                span_type = "agent"
            elif span.name.startswith("tool."):
                span_type = "tool"
            elif span.name.startswith("step."):
                span_type = "step"
            elif "span_type" in attributes:
                span_type = attributes["span_type"]

            return {
                "trace_id": trace_id,
                "span_id": span_id,
                "parent_span_id": parent_span_id,
                "name": span.name,
                "span_type": span_type,
                "attributes": attributes if attributes else None,
                "events": events_data if events_data else None,
                "input": input_data,
                "output": output_data,
                "error": error_data,
                "initial_state": initial_state,
                "final_state": final_state,
                "started_at": started_at,
                "ended_at": ended_at,
            }

        async def _store_spans_batch(self, spans: list[dict[str, Any]]):
            """Store a batch of spans to the database via API.

            Args:
                spans: List of span dictionaries

            Note:
                This runs in the exporter's dedicated event loop, so we cannot reuse
                the worker's HTTP client (which is bound to a different event loop).
                We must create a new client in this event loop.
            """
            try:
                polos_client = get_client_or_raise()
                api_url = polos_client.api_url
                headers = polos_client._get_headers()

                # Create a new client in this event loop (cannot reuse worker's client
                # as it's bound to a different event loop)
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"{api_url}/internal/spans/batch",
                        json={"spans": spans},
                        headers=headers,
                    )
                    response.raise_for_status()
            except Exception as e:
                logger.warning(f"Failed to store spans batch: {e}")

        def shutdown(self):
            """Clean shutdown of exporter."""
            if self.loop and self.loop.is_running():
                try:
                    # Schedule loop stop
                    self.loop.call_soon_threadsafe(self.loop.stop)
                    # Wait for thread to finish (with timeout)
                    if self.loop_thread and self.loop_thread.is_alive():
                        self.loop_thread.join(timeout=5)
                except Exception as e:
                    logger.warning(f"Error during exporter shutdown: {e}")
                finally:
                    # Close the loop
                    if self.loop and not self.loop.is_closed():
                        try:
                            # Cancel any pending tasks
                            pending = asyncio.all_tasks(self.loop)
                            for task in pending:
                                task.cancel()
                            # Run one more iteration to process cancellations
                            if pending:
                                self.loop.run_until_complete(
                                    asyncio.gather(*pending, return_exceptions=True)
                                )
                        except Exception:
                            pass
                        finally:
                            self.loop.close()
else:
    # No-op class when OpenTelemetry is not available
    class DatabaseSpanExporter:
        def __init__(self):
            pass

        def export(self, spans):
            return None

        def shutdown(self):
            pass


if OTELEMETRY_AVAILABLE:

    class DeterministicTraceIdGenerator(RandomIdGenerator):
        """ID generator that uses deterministic trace IDs from context if available."""

        def generate_trace_id(self) -> int:
            # Check if we have a deterministic trace_id in context
            # context.get_value() requires passing the context explicitly or it uses get_current()
            current_ctx = context.get_current()
            deterministic_trace_id = context.get_value("polos.trace_id", context=current_ctx)
            if deterministic_trace_id is not None:
                logger.debug(
                    f"Using deterministic trace_id from context: {deterministic_trace_id:032x}"
                )
                return deterministic_trace_id
            # Otherwise generate random
            return super().generate_trace_id()
else:
    # No-op class when OpenTelemetry is not available
    class DeterministicTraceIdGenerator:
        def generate_trace_id(self) -> int:
            return 0


def initialize_otel():
    """Initialize OpenTelemetry SDK."""
    global _tracer_provider, _tracer

    if not OTELEMETRY_AVAILABLE:
        logger.warning("OpenTelemetry not available. Tracing disabled.")
        return

    try:
        # Check if enabled
        if os.getenv("POLOS_OTEL_ENABLED", "true").lower() != "true":
            _tracer = trace.NoOpTracer()
            return

        # Initialize provider with custom IdGenerator for deterministic trace IDs
        _tracer_provider = TracerProvider(id_generator=DeterministicTraceIdGenerator())

        # Add database exporter (MVP - DB storage only)
        db_exporter = DatabaseSpanExporter()
        _tracer_provider.add_span_processor(BatchSpanProcessor(db_exporter))

        # Future: Add OTLP exporter if endpoint is configured
        # otlp_endpoint = os.getenv("POLOS_OTEL_ENDPOINT")
        # if otlp_endpoint:
        #     from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        #     otlp_exporter = OTLPSpanExporter(endpoint=otlp_endpoint)
        #     _tracer_provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

        # Set as global
        trace.set_tracer_provider(_tracer_provider)

        # Get tracer
        service_name = os.getenv("POLOS_OTEL_SERVICE_NAME", "polos")
        _tracer = trace.get_tracer(service_name)

        logger.info("OpenTelemetry initialized with database exporter")

    except Exception as e:
        # Log error but continue with no-op tracer
        logger.warning(f"Failed to initialize OpenTelemetry: {e}. Tracing disabled.")
        _tracer = trace.NoOpTracer()


def get_current_span() -> Span | None:
    """Get the current active span."""
    if not OTELEMETRY_AVAILABLE:
        return None
    return trace.get_current_span()


def extract_traceparent(span: Span) -> str | None:
    """Extract traceparent string from a span for cross-process propagation.

    Args:
        span: The span to extract trace context from

    Returns:
        traceparent string in W3C format, or None if not available
    """
    if not OTELEMETRY_AVAILABLE or span is None:
        return None

    try:
        propagator = get_propagator()
        if propagator is None:
            return None

        # Extract trace context
        carrier = {}
        span_context = span.get_span_context()
        if span_context and span_context.is_valid:
            # Create a context with the span
            from opentelemetry.trace import set_span_in_context

            ctx = set_span_in_context(span)
            propagator.inject(carrier, context=ctx)
            return carrier.get("traceparent")
    except Exception as e:
        logger.warning(f"Failed to extract traceparent: {e}")

    return None


def create_context_from_traceparent(traceparent: str):
    """Create OpenTelemetry context from traceparent string.

    When extracting from a traceparent, we get a context with a SpanContext.
    We need to wrap this in a NonRecordingSpan and set it in the context
    so that child spans created with this context will be properly linked
    to the parent span.

    Args:
        traceparent: W3C traceparent string (format: version-trace_id-parent_span_id-flags)

    Returns:
        OpenTelemetry context with parent span set, or None if extraction fails
    """
    if not OTELEMETRY_AVAILABLE or not traceparent:
        return None

    try:
        propagator = get_propagator()
        if propagator is None:
            logger.warning("Propagator is None, cannot extract trace context")
            return None

        # Extract context from traceparent
        # The traceparent format is: version-trace_id-parent_span_id-flags
        carrier = {"traceparent": traceparent}
        extracted_context = propagator.extract(carrier)

        if extracted_context is None:
            logger.warning(f"Propagator.extract returned None for traceparent: {traceparent}")
            return None

        return extracted_context
    except Exception as e:
        logger.warning(
            f"Failed to create context from traceparent '{traceparent}': {e}", exc_info=True
        )

    return None


def create_context_with_trace_id(trace_id: int):
    """Create OpenTelemetry context with a deterministic trace ID.

    This creates a context that will make the next span a ROOT span
    (no parent) but within the specified trace. The IdGenerator will
    pick up the trace_id from this context.

    Args:
        trace_id: Trace ID as integer (128 bits)

    Returns:
        OpenTelemetry context configured for the trace ID
    """
    if not OTELEMETRY_AVAILABLE:
        return None

    try:
        # Store the trace_id in context using a custom key
        # This will be picked up by our custom DeterministicTraceIdGenerator
        ctx = context.get_current()
        ctx = context.set_value("polos.trace_id", trace_id, ctx)
        logger.debug(f"Set trace_id in context: {trace_id:032x}")
        return ctx

    except Exception as e:
        logger.warning(f"Failed to create context with trace ID: {e}")

    return None


def generate_trace_id_from_execution_id(execution_id: str) -> int:
    """Generate a deterministic trace ID from execution_id.

    Args:
        execution_id: Execution ID string (UUID format)

    Returns:
        Trace ID as integer (128 bits)
    """
    # Remove dashes from UUID and convert to int
    hex_str = execution_id.replace("-", "")
    # Ensure it's exactly 32 hex characters (128 bits)
    if len(hex_str) != 32:
        raise ValueError(f"Invalid execution_id format: {execution_id}")
    return int(hex_str, 16)


def format_timestamp(dt: datetime) -> str:
    """Format datetime to ISO string."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()
