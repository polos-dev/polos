from opentelemetry.trace import NonRecordingSpan, set_span_in_context


def get_parent_span_context_from_execution_context(exec_context):
    parent_context = None
    if exec_context:
        parent_span_context = exec_context.get("_otel_span_context")
        if parent_span_context:
            # Convert SpanContext to Context by wrapping in NonRecordingSpan
            parent_span = NonRecordingSpan(parent_span_context)
            parent_context = set_span_in_context(parent_span)

    return parent_context


def get_span_context_from_execution_context(exec_context):
    if exec_context:
        return exec_context.get("_otel_span_context")
    return None


def set_span_context_in_execution_context(exec_context, span_context):
    if exec_context:
        exec_context["_otel_span_context"] = span_context
        if span_context is not None:
            exec_context["_otel_trace_id"] = format(span_context.trace_id, "032x")
            exec_context["_otel_span_id"] = format(span_context.span_id, "016x")
