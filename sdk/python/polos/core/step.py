"""Step execution helper for durable execution within workflows."""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import os
import random as random_module
import time
import uuid as uuid_module
from collections.abc import Callable
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

from ..features.events import EventData, EventPayload, batch_publish
from ..features.tracing import extract_traceparent, get_current_span, get_tracer
from ..features.wait import WaitException, _get_wait_time, _set_waiting
from ..runtime.client import ExecutionHandle, get_step_output, store_step_output
from ..types.types import BatchStepResult, BatchWorkflowInput
from ..utils.client_context import get_client_or_raise
from ..utils.retry import retry_with_backoff
from ..utils.serializer import deserialize, safe_serialize, serialize
from ..utils.tracing import (
    get_parent_span_context_from_execution_context,
    get_span_context_from_execution_context,
    set_span_context_in_execution_context,
)
from .context import WorkflowContext
from .workflow import (
    StepExecutionError,
    Workflow,
    _execution_context,
    get_workflow,
)

logger = logging.getLogger(__name__)


class Step:
    """Step execution helper - provides durable execution primitives.

    Steps are executed within a workflow context and their outputs are
    saved to avoid re-execution on workflow resume/replay.
    """

    def __init__(self, ctx: WorkflowContext):
        """Initialize Step with a WorkflowContext.

        Args:
            ctx: The workflow execution context
        """
        self.ctx = ctx

    async def _check_existing_step(self, step_key: str) -> dict[str, Any] | None:
        """
        Check for existing step output using step_key.

        Args:
            step_key: Step key identifier (must be unique per execution)
            workflow: Whether the step is a workflow step

        Returns:
            existing_step_output or None
            - If existing_step_output is not None, it means the step was already executed
            - The caller should handle returning cached results or raising errors
        """
        return await get_step_output(self.ctx.execution_id, step_key)

    async def _handle_existing_step(
        self,
        existing_step: dict[str, Any],
    ) -> Any:
        """
        Handle existing step output - either return cached result or raise error.

        Args:
            existing_step: The existing step output from _check_existing_step
            workflow: Whether the step is a workflow step

        Returns:
            Cached result (from on_success callback or existing_step.get("outputs"))

        Raises:
            StepExecutionError: If step previously failed
        """
        if existing_step.get("success", False):
            outputs = existing_step.get("outputs")
            if outputs:
                result = await deserialize(outputs, existing_step.get("output_schema_name"))
                return result
            else:
                return None
        else:
            error = existing_step.get("error", {})
            error_message = (
                error.get("message", "Step execution failed")
                if isinstance(error, dict)
                else str(error)
            )
            raise StepExecutionError(error_message)

    async def _save_step_output(
        self,
        step_key: str,
        result: Any,
        source_execution_id: str | None = None,
    ) -> None:
        """Save step output to database using step_key as the unique identifier.

        Args:
            step_key: Step key identifier (must be unique per execution)
            result: Result to save
            source_execution_id: Optional source execution ID

        If result is a Pydantic BaseModel, converts it to dict using model_dump(mode="json")
        to ensure only valid Pydantic models are stored. model_dump(mode="json") automatically
        handles nested Pydantic models within the model.

        Also extracts and stores the full module path of Pydantic classes for
        automatic deserialization when reading from the database.

        If result is not a Pydantic model, validates that it's JSON serializable
        by attempting json.dumps(). Raises StepExecutionError if not serializable.
        """
        output_schema_name = None
        if isinstance(result, BaseModel):
            outputs = result.model_dump(mode="json")
            # Extract full module path for Pydantic class
            # (e.g., "polos.llm.providers.base.LLMResponse")
            output_schema_name = f"{result.__class__.__module__}.{result.__class__.__name__}"
        elif isinstance(result, list) and result and isinstance(result[0], BaseModel):
            # Handle list of Pydantic models
            outputs = [item.model_dump(mode="json") for item in result]
            # Store schema name of the list item type for deserialization
            output_schema_name = (
                f"list[{result[0].__class__.__module__}.{result[0].__class__.__name__}]"
            )
        else:
            outputs = result

        await store_step_output(
            execution_id=self.ctx.execution_id,
            step_key=step_key,
            outputs=outputs,
            error=None,
            success=True,
            source_execution_id=source_execution_id,
            output_schema_name=output_schema_name,
        )

    async def _save_step_output_with_error(
        self,
        step_key: str,
        error: str,
    ) -> None:
        """Save step output with error to database."""
        await store_step_output(
            execution_id=self.ctx.execution_id,
            step_key=step_key,
            outputs=None,
            error={"message": error},
            success=False,
            source_execution_id=None,
        )

    async def _raise_step_execution_error(self, step_key: str, error: str) -> None:
        """Raise a step execution error."""
        await self._save_step_output_with_error(
            step_key,
            error,
        )
        raise StepExecutionError(error)

    async def _publish_step_event(
        self,
        event_type: str,
        step_key: str,
        step_type: str,
        input_params: dict[str, Any],
    ) -> None:
        """Publish a step event for the current workflow (fire-and-forget).

        Args:
            event_type: Type of event (e.g., "step_start", "step_finish")
            step_key: Step key/identifier
            step_type: Type of step (e.g., "run", "wait_for", "invoke", etc.)
            input_params: Input parameters for the step
        """
        events = [
            EventData(
                data={
                    "step_key": step_key,
                    "step_type": step_type,
                    "data": safe_serialize(input_params) if input_params else {},
                    "_metadata": {
                        "execution_id": self.ctx.execution_id,
                        "workflow_id": self.ctx.workflow_id,
                    },
                },
                event_type=event_type,
            )
        ]
        # Fire-and-forget: spawn task without awaiting to reduce latency
        client = get_client_or_raise()
        asyncio.create_task(
            batch_publish(
                client=client,
                topic=f"workflow/{self.ctx.root_workflow_id}/{self.ctx.root_execution_id}",
                events=events,
                execution_id=self.ctx.execution_id,
                root_execution_id=self.ctx.root_execution_id,
            )
        )

    async def run(
        self,
        step_key: str,
        func: Callable,
        *args,
        max_retries: int = 2,
        base_delay: float = 1.0,
        max_delay: float = 10.0,
        **kwargs,
    ) -> Any:
        """
        Execute a callable as a durable step with retry support.

        Checks step_outputs for existing result. If found, returns cached result.
        Otherwise, executes function with retries, saves output, and returns result.

        Args:
            step_key: Step key identifier (must be unique per execution)
            func: Callable to execute (sync or async)
            *args: Positional arguments to pass to function
            max_retries: Maximum number of retries on failure (default: 2)
            base_delay: Base delay in seconds for exponential backoff (default: 1.0)
            max_delay: Maximum delay in seconds (default: 10.0)
            **kwargs: Keyword arguments to pass to function

        Returns:
            Result of function execution

        Raises:
            StepExecutionError: If function fails after all retries
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            return await self._handle_existing_step(existing_step)

        # Get parent span context from execution context
        exec_context = _execution_context.get()
        parent_context = get_parent_span_context_from_execution_context(exec_context)
        tracer = get_tracer()

        # Create span for step execution using context manager
        with tracer.start_as_current_span(
            name=f"step.{step_key}",
            context=parent_context,  # None for root, or parent context for child
            attributes={
                "step.key": step_key,
                "step.function": func.__name__ if hasattr(func, "__name__") else str(func),
                "step.execution_id": self.ctx.execution_id,
                "step.max_retries": max_retries,
            },
        ) as step_span:
            # Update execution context with current span for nested spans
            # Save old values to restore later
            old_span_context = get_span_context_from_execution_context(exec_context)
            set_span_context_in_execution_context(exec_context, step_span.get_span_context())
            try:
                # Use safe_serialize here because function arguments may be complex objects
                # and may not be JSON serializable
                safe_args = [safe_serialize(arg) for arg in args]
                safe_kwargs = {k: safe_serialize(v) for k, v in kwargs.items()}

                input_params = {
                    "func": func.__name__ if hasattr(func, "__name__") else str(func),
                    "args": safe_args,
                    "kwargs": safe_kwargs,
                    "max_retries": max_retries,
                    "base_delay": base_delay,
                    "max_delay": max_delay,
                }

                await self._publish_step_event(
                    "step_start",
                    step_key,
                    "run",
                    input_params,
                )

                # Store input in span attributes as JSON string
                step_span.set_attributes(
                    {
                        "step.input": json.dumps(
                            {
                                "args": safe_args,
                                "kwargs": safe_kwargs,
                            }
                        ),
                        "step.function": func.__name__ if hasattr(func, "__name__") else str(func),
                        "step.max_retries": max_retries,
                        "step.base_delay": base_delay,
                        "step.max_delay": max_delay,
                    }
                )

                # Execute the function with retries
                async def _execute_func() -> Any:
                    is_async = asyncio.iscoroutinefunction(func)
                    if is_async:
                        return await func(*args, **kwargs)
                    else:
                        # Run sync function in executor
                        # IMPORTANT: Capture the current context (including ContextVar values)
                        # so they can be restored in the executor thread
                        func_ctx = contextvars.copy_context()
                        loop = asyncio.get_event_loop()

                        # Execute in executor with context restored
                        def run_with_context():
                            return func_ctx.run(func, *args, **kwargs)

                        return await loop.run_in_executor(None, run_with_context)

                try:
                    result = await retry_with_backoff(
                        _execute_func,
                        max_retries=max_retries,
                        base_delay=base_delay,
                        max_delay=max_delay,
                    )
                    serialized_result = serialize(result)

                    # Set span status to success
                    step_span.set_status(Status(StatusCode.OK))
                    step_span.set_attributes(
                        {
                            "step.status": "completed",
                            "step.output": json.dumps(serialized_result),
                        }
                    )

                    # Publish step_finish event
                    await self._publish_step_event(
                        "step_finish",
                        step_key,
                        "run",
                        {"result": serialized_result},
                    )

                    # Save step output on success
                    await self._save_step_output(
                        step_key,
                        result,
                    )

                    # Span automatically ended and stored by DatabaseSpanExporter
                    return result
                except Exception as e:
                    # Set span status to error
                    step_span.set_status(Status(StatusCode.ERROR, str(e)))
                    step_span.record_exception(e)

                    # Store error in span attributes as JSON string
                    error_message = str(e)
                    step_error = {
                        "message": error_message,
                        "type": type(e).__name__,
                    }
                    step_span.set_attributes(
                        {
                            "step.error": json.dumps(safe_serialize(step_error)),
                            "step.status": "failed",
                        }
                    )

                    # Save error to step output
                    await self._save_step_output_with_error(
                        step_key,
                        error_message,
                    )

                    # Span automatically ended and stored by DatabaseSpanExporter
                    raise StepExecutionError(
                        f"Step execution failed after {max_retries} retries: {error_message}"
                    ) from e
            finally:
                # Restore previous span context values
                set_span_context_in_execution_context(exec_context, old_span_context)

    async def wait_for(
        self,
        step_key: str,
        seconds: float | None = None,
        minutes: float | None = None,
        hours: float | None = None,
        days: float | None = None,
        weeks: float | None = None,
    ) -> None:
        """Wait for a time duration.

        Args:
            step_key: Step key identifier (must be unique per execution)
            seconds: Optional seconds to wait
            minutes: Optional minutes to wait
            hours: Optional hours to wait
            days: Optional days to wait
            weeks: Optional weeks to wait
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            return await self._handle_existing_step(existing_step)

        wait_seconds, wait_until = await _get_wait_time(seconds, minutes, hours, days, weeks)
        if wait_seconds <= 0:
            await self._raise_step_execution_error(step_key, error="Wait duration must be positive")

        # Add span event for wait
        current_span = get_current_span()
        if current_span and hasattr(current_span, "add_event"):
            # Build attributes dict, filtering out None values (OpenTelemetry doesn't accept None)
            attributes = {
                "step.key": step_key,
                "wait.seconds": wait_seconds,
            }
            if wait_until:
                attributes["wait.until"] = wait_until.isoformat()
            if seconds is not None:
                attributes["wait.seconds_param"] = seconds
            if minutes is not None:
                attributes["wait.minutes_param"] = minutes
            if hours is not None:
                attributes["wait.hours_param"] = hours
            if days is not None:
                attributes["wait.days_param"] = days
            if weeks is not None:
                attributes["wait.weeks_param"] = weeks

            current_span.add_event("step.wait_for", attributes=attributes)

        # Get wait threshold from environment (default 10 seconds)
        wait_threshold = float(os.getenv("POLOS_WAIT_THRESHOLD_SECONDS", "10.0"))

        if wait_seconds <= wait_threshold:
            # Short wait - just sleep without raising WaitException
            await asyncio.sleep(wait_seconds)
            result = {"wait_until": wait_until.isoformat()}
            await self._save_step_output(
                step_key,
                result,
            )
            return

        # Long wait - pause execution atomically
        await _set_waiting(
            self.ctx.execution_id,
            wait_until,
            "time",
            step_key,
        )

        # Raise a special exception to pause execution
        # The orchestrator will resume it when wait_until is reached
        raise WaitException(f"Waiting until {wait_until.isoformat()}")

    async def wait_until(self, step_key: str, timestamp: datetime) -> None:
        """Wait until a timestamp.

        Args:
            step_key: Step key identifier (must be unique per execution)
            timestamp: Timestamp to wait until
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            return await self._handle_existing_step(existing_step)

        # Ensure date is timezone-aware (use UTC if naive)
        date = timestamp
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)

        # Convert to UTC
        wait_until = date.astimezone(timezone.utc)
        now = datetime.now(timezone.utc)

        if wait_until < now:
            # Date is in the past, raise error
            await self._raise_step_execution_error(
                step_key, error=f"Wait date {timestamp} is in the past"
            )

        # Calculate wait duration
        wait_seconds = (wait_until - now).total_seconds()
        if wait_seconds < 0:
            await self._raise_step_execution_error(
                step_key, error=f"Wait date {timestamp} is in the past"
            )

        # Add span event for wait
        current_span = get_current_span()
        if current_span and hasattr(current_span, "add_event"):
            current_span.add_event(
                "step.wait_until",
                attributes={
                    "step.key": step_key,
                    "wait.timestamp": timestamp.isoformat(),
                    "wait.until": wait_until.isoformat(),
                    "wait.seconds": wait_seconds,
                },
            )

        # Get wait threshold from environment (default 10 seconds)
        wait_threshold = float(os.getenv("POLOS_WAIT_THRESHOLD_SECONDS", "10.0"))

        if wait_seconds <= wait_threshold:
            # Short wait - just sleep without raising WaitException
            await asyncio.sleep(wait_seconds)
            result = {"wait_until": wait_until.isoformat()}
            await self._save_step_output(
                step_key,
                result,
            )
            return

        # Long wait - pause execution atomically
        await _set_waiting(
            self.ctx.execution_id,
            wait_until,
            "time",
            step_key,
        )

        # Raise a special exception to pause execution
        # The orchestrator will resume it when wait_until is reached
        raise WaitException(f"Waiting until {wait_until.isoformat()}")

    async def wait_for_event(
        self, step_key: str, topic: str, timeout: int | None = None
    ) -> EventPayload:
        """Wait for an event on a topic.

        Args:
            step_key: Step key identifier (must be unique per execution)
            topic: Event topic to wait for
            timeout: Optional timeout in seconds. If provided, wait will expire after this duration.

        Returns:
            EventPayload: Event payload with sequence_id, topic, event_type, data, and created_at
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            result = await self._handle_existing_step(existing_step)
            # Convert dict to EventPayload
            if isinstance(result, dict):
                return EventPayload.model_validate(result)
            # If not event data, return as-is (shouldn't happen for wait_for_event)
            return result

        # Calculate expires_at if timeout is provided
        expires_at = None
        if timeout is not None:
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=timeout)

        # Add span event for wait
        current_span = get_current_span()
        if current_span and hasattr(current_span, "add_event"):
            wait_attributes = {
                "step.key": step_key,
                "wait.topic": topic,
            }
            if timeout is not None:
                wait_attributes["wait.timeout"] = timeout
            if expires_at is not None:
                wait_attributes["wait.expires_at"] = expires_at.isoformat()
            current_span.add_event("step.wait_for_event", attributes=wait_attributes)

        # Add row in wait_steps with wait_type="event", wait_topic=topic, expires_at=timeout
        await _set_waiting(
            self.ctx.execution_id,
            wait_until=expires_at,
            wait_type="event",
            step_key=step_key,
            wait_topic=topic,
            expires_at=expires_at,
        )

        # Raise WaitException to pause execution
        # When resumed, execution continues from here and will check execution_step_outputs again
        raise WaitException(f"Waiting for event on topic: {topic}")

    async def publish_event(
        self,
        step_key: str,
        topic: str,
        data: dict[str, Any],
        event_type: str | None = None,
    ) -> None:
        """Publish an event as a step.

        Args:
            step_key: Step key identifier (must be unique per execution)
            topic: Event topic
            data: Event data
            event_type: Optional event type
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            return await self._handle_existing_step(existing_step)

        events = [EventData(data=data, event_type=event_type)]
        # Publish event
        client = get_client_or_raise()
        await batch_publish(
            client=client,
            topic=topic,
            events=events,
            execution_id=self.ctx.execution_id,
            root_execution_id=self.ctx.root_execution_id,
        )

        await self._save_step_output(
            step_key,
            None,
        )

    async def publish_workflow_event(
        self,
        step_key: str,
        data: dict[str, Any],
        event_type: str | None = None,
    ) -> None:
        """Publish an event for the current workflow as a step.

        Args:
            step_key: Step key identifier (must be unique per execution)
            data: Event data
            event_type: Optional event type
        """
        topic = f"workflow/{self.ctx.root_workflow_id}/{self.ctx.root_execution_id}"
        return await self.publish_event(step_key, topic, data, event_type)

    async def suspend(
        self, step_key: str, data: dict[str, Any] | BaseModel, timeout: int | None = None
    ) -> Any:
        """Suspend execution and wait for a resume event.

        Publishes a suspend event on the shared workflow topic with
        event_type="suspend_{step_key}". The orchestrator will resume when it
        sees a matching event_type="resume_{step_key}" on the same topic.

        Args:
            step_key: Step key identifier (must be unique per execution)
            data: Data to associate with the suspend (can be dict or Pydantic BaseModel)
            timeout: Optional timeout in seconds. If provided, wait will expire after this duration.

        Returns:
            Event data from the resume event
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            return await self._handle_existing_step(existing_step)

        serialized_data = serialize(data)
        topic = f"workflow/{self.ctx.root_workflow_id}/{self.ctx.root_execution_id}"
        # Publish suspend event
        client = get_client_or_raise()
        await batch_publish(
            client=client,
            topic=topic,
            events=[EventData(data=serialized_data, event_type=f"suspend_{step_key}")],
            execution_id=self.ctx.execution_id,
            root_execution_id=self.ctx.root_execution_id,
        )

        # Calculate expires_at if timeout is provided
        expires_at = None
        if timeout is not None:
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=timeout)

        # Add row in wait_steps with wait_type="suspend", wait_topic=topic, expires_at=timeout
        # Using "suspend" (not "event") so the orchestrator can distinguish from wait_for_event
        # and require event_type="resume_{step_key}" matching for resume.
        await _set_waiting(
            self.ctx.execution_id,
            wait_until=expires_at,
            wait_type="suspend",
            step_key=step_key,
            wait_topic=topic,
            expires_at=expires_at,
        )

        # Resume event will be added to step outputs by the orchestrator when it is received

        # Raise WaitException to pause execution
        # When resumed, execution continues from here and will check execution_step_outputs again
        raise WaitException(f"Waiting for resume event: {topic}")

    async def resume(
        self,
        step_key: str,
        suspend_step_key: str,
        suspend_execution_id: str,
        suspend_workflow_id: str,
        data: dict[str, Any] | BaseModel,
    ) -> None:
        """Resume a suspended execution by publishing a resume event.

        Publishes an event on the shared workflow topic with
        event_type="resume_{suspend_step_key}". The orchestrator matches this
        against wait_steps where step_key matches.

        Args:
            step_key: Step key identifier for this resume step (must be unique per execution)
            suspend_step_key: The step key used in the original suspend() call
            suspend_execution_id: The root execution ID of the suspended execution
            suspend_workflow_id: The root workflow ID of the suspended execution
            data: Data to pass in the resume event (can be dict or Pydantic BaseModel)
        """
        serialized_data = serialize(data)

        topic = f"workflow/{suspend_workflow_id}/{suspend_execution_id}"

        # Publish event with event_type="resume_{step_key}"
        await self.publish_event(
            step_key=step_key,
            topic=topic,
            data=serialized_data,
            event_type=f"resume_{suspend_step_key}",
        )

    async def _invoke(
        self,
        step_key: str,
        workflow: str | Workflow,
        payload: Any,
        initial_state: dict[str, Any] | BaseModel | None = None,
        queue: str | None = None,
        concurrency_key: str | None = None,
        run_timeout_seconds: int | None = None,
        wait_for_subworkflow: bool = False,
    ) -> Any:
        """
        Invoke another workflow as a step.

        Args:
            step_key: Step key identifier (must be unique per execution)
            workflow: Workflow ID or Workflow instance
            payload: Payload for the workflow
            queue: Optional queue name
            concurrency_key: Optional concurrency key
            wait_for_subworkflow: Whether to wait for sub-workflow completion

        Returns:
            A tuple containing [ExecutionHandle of the sub-workflow,
            True if the step output was found, False otherwise]
        """
        # Get workflow ID
        if isinstance(workflow, Workflow):
            workflow_id = workflow.id
            workflow_instance = workflow
        else:
            workflow_id = workflow
            workflow_instance = get_workflow(workflow_id)

        if not workflow_instance:
            raise StepExecutionError(f"Workflow {workflow_id} not found")

        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            result = await self._handle_existing_step(existing_step)
            return result, True

        # Extract trace context for propagation to sub-workflow
        exec_context = _execution_context.get()
        traceparent = None
        if exec_context:
            # Get current span and extract traceparent
            current_span = get_current_span()
            if current_span:
                traceparent = extract_traceparent(current_span)

        # Invoke workflow
        client = get_client_or_raise()
        handle = await workflow_instance._invoke(
            client,
            payload,
            initial_state=initial_state,
            queue=queue,
            concurrency_key=concurrency_key,
            session_id=self.ctx.session_id,
            user_id=self.ctx.user_id,
            deployment_id=self.ctx.deployment_id,
            parent_execution_id=self.ctx.execution_id,
            root_workflow_id=self.ctx.root_workflow_id,
            root_execution_id=self.ctx.root_execution_id or self.ctx.execution_id,
            step_key=step_key if wait_for_subworkflow else None,
            wait_for_subworkflow=wait_for_subworkflow,
            otel_traceparent=traceparent,
            run_timeout_seconds=run_timeout_seconds,
        )

        if wait_for_subworkflow:
            # No need to save the handle
            # Orchestrator will save the output on completion
            return None, False
        else:
            await self._save_step_output(
                step_key,
                handle,
            )
            return handle, False

    async def invoke(
        self,
        step_key: str,
        workflow: str | Workflow,
        payload: Any,
        initial_state: BaseModel | dict[str, Any] | None = None,
        queue: str | None = None,
        concurrency_key: str | None = None,
        run_timeout_seconds: int | None = None,
    ) -> Any:
        """
        Invoke another workflow as a step.

        Args:
            step_key: Step key identifier (must be unique per execution)
            workflow: Workflow ID or Workflow instance
            payload: Payload for the workflow
            queue: Optional queue name
            concurrency_key: Optional concurrency key
            run_timeout_seconds: Optional timeout in seconds

        Returns:
            ExecutionHandle of the sub-workflow
        """
        # Note: step_finish will be emitted by the orchestrator when it saves the step output
        result, found = await self._invoke(
            step_key,
            workflow,
            payload,
            initial_state,
            queue,
            concurrency_key,
            wait_for_subworkflow=False,
            run_timeout_seconds=run_timeout_seconds,
        )
        return result

    async def invoke_and_wait(
        self,
        step_key: str,
        workflow: str | Workflow,
        payload: Any,
        initial_state: BaseModel | dict[str, Any] | None = None,
        queue: str | None = None,
        concurrency_key: str | None = None,
        run_timeout_seconds: int | None = None,
    ) -> Any:
        """
        Invoke another workflow as a step.

        This creates a child workflow execution and waits for it.
        Note that this will raise WaitException to pause execution until the
        child workflow completes.

        Args:
            step_key: Step key identifier (must be unique per execution)
            workflow: Workflow ID or Workflow instance
            payload: Payload for the workflow
            queue: Optional queue name
            concurrency_key: Optional concurrency key

        Returns:
            Any: Result of the child workflow
        """
        result, found = await self._invoke(
            step_key,
            workflow,
            payload,
            initial_state,
            queue,
            concurrency_key,
            wait_for_subworkflow=True,
            run_timeout_seconds=run_timeout_seconds,
        )
        if found:
            # Step is complete, return result
            return result

        # Step did not exist, execute wait
        from ..features.wait import WaitException

        workflow_id = workflow.id if isinstance(workflow, Workflow) else workflow
        raise WaitException(f"Waiting for sub-workflow {workflow_id} to complete")

    async def batch_invoke(
        self,
        step_key: str,
        workflows: list[BatchWorkflowInput],
    ) -> list[ExecutionHandle]:
        """
        Invoke multiple workflows as a single step using the batch endpoint.

        Args:
            workflows: List of BatchWorkflowInput objects with 'id'
                (workflow_id string) and 'payload' (dict or Pydantic model)

        Returns:
            List of ExecutionHandle objects for the submitted workflows
        """
        if not workflows:
            return []

        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            # Extract handles from existing step output
            existing_output = await self._handle_existing_step(existing_step)
            if existing_output and isinstance(existing_output, list):
                handles = [
                    ExecutionHandle.model_validate(handle_data) for handle_data in existing_output
                ]
                return handles
            return []

        # Extract trace context for propagation to sub-workflow
        exec_context = _execution_context.get()
        traceparent = None
        if exec_context:
            # Get current span and extract traceparent
            current_span = get_current_span()
            if current_span:
                traceparent = extract_traceparent(current_span)

        # Build workflow requests for batch submission
        workflow_requests = []
        for workflow_input in workflows:
            workflow_id = workflow_input.id
            payload = serialize(workflow_input.payload)

            workflow_obj = get_workflow(workflow_id)
            if not workflow_obj:
                raise StepExecutionError(f"Workflow '{workflow_id}' not found")

            workflow_req = {
                "workflow_id": workflow_id,
                "payload": payload,
                "initial_state": serialize(workflow_input.initial_state),
                "run_timeout_seconds": workflow_input.run_timeout_seconds,
            }

            # Per-workflow properties (queue_name, concurrency_key, etc.)
            if workflow_obj.queue_name is not None:
                workflow_req["queue_name"] = workflow_obj.queue_name

            if workflow_obj.queue_concurrency_limit is not None:
                workflow_req["queue_concurrency_limit"] = workflow_obj.queue_concurrency_limit

            workflow_requests.append(workflow_req)

        # Submit all workflows in a single batch using the batch endpoint
        client = get_client_or_raise()
        handles = await client._submit_workflows(
            workflows=workflow_requests,
            deployment_id=self.ctx.deployment_id,
            parent_execution_id=self.ctx.execution_id,
            root_workflow_id=self.ctx.root_workflow_id,
            root_execution_id=self.ctx.root_execution_id or self.ctx.execution_id,
            step_key=None,  # Don't set step_key since we don't want to wait
            # for the batch to complete
            session_id=self.ctx.session_id,
            user_id=self.ctx.user_id,
            wait_for_subworkflow=False,  # batch_invoke is fire-and-forget
            otel_traceparent=traceparent,
        )

        await self._save_step_output(
            step_key,
            handles,
        )
        return handles

    async def batch_invoke_and_wait(
        self,
        step_key: str,
        workflows: list[BatchWorkflowInput],
    ) -> list[BatchStepResult]:
        """
        Invoke multiple workflows as a single step using the batch endpoint
        and wait for all to complete.

        Args:
            workflows: List of BatchWorkflowInput objects with 'id'
                (workflow_id string) and 'payload' (dict or Pydantic model)

        Returns:
            List of BatchStepResult objects, one for each workflow
        """
        if not workflows:
            return []

        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            # Extract results from existing step output
            existing_output = None
            try:
                existing_output = await self._handle_existing_step(existing_step)
            except Exception:
                existing_output = existing_step.get("outputs")

            if existing_output and isinstance(existing_output, list):
                # Reconstruct BatchStepResult objects from stored dicts
                batch_results = []
                for item in existing_output:
                    result = item.get("result")
                    if result:
                        deserialized_result = await deserialize(
                            result, item.get("result_schema_name")
                        )
                        item["result"] = deserialized_result

                    batch_results.append(BatchStepResult.model_validate(item))
                return batch_results
            return []

        # Extract trace context for propagation to sub-workflow
        exec_context = _execution_context.get()
        traceparent = None
        if exec_context:
            # Get current span and extract traceparent
            current_span = get_current_span()
            if current_span:
                traceparent = extract_traceparent(current_span)

        # Build workflow requests for batch submission
        workflow_requests = []
        for _i, workflow_input in enumerate(workflows):
            workflow_id = workflow_input.id
            payload = serialize(workflow_input.payload)

            workflow_obj = get_workflow(workflow_id)
            if not workflow_obj:
                raise StepExecutionError(f"Workflow '{workflow_id}' not found")

            workflow_req = {
                "workflow_id": workflow_id,
                "payload": payload,
                "initial_state": serialize(workflow_input.initial_state),
                "run_timeout_seconds": workflow_input.run_timeout_seconds,
            }

            # Per-workflow properties (queue_name, concurrency_key, etc.)
            if workflow_obj.queue_name is not None:
                workflow_req["queue_name"] = workflow_obj.queue_name

            if workflow_obj.queue_concurrency_limit is not None:
                workflow_req["queue_concurrency_limit"] = workflow_obj.queue_concurrency_limit

            workflow_requests.append(workflow_req)

        # Submit all workflows in a single batch using the batch endpoint
        # with wait_for_subworkflow=True
        client = get_client_or_raise()
        await client._submit_workflows(
            workflows=workflow_requests,
            deployment_id=self.ctx.deployment_id,
            parent_execution_id=self.ctx.execution_id,
            root_workflow_id=self.ctx.root_workflow_id,
            root_execution_id=self.ctx.root_execution_id or self.ctx.execution_id,
            step_key=step_key,
            session_id=self.ctx.session_id,
            user_id=self.ctx.user_id,
            wait_for_subworkflow=True,  # This will set parent to waiting until all complete
            otel_traceparent=traceparent,
        )

        # Raise WaitException to pause execution
        # The orchestrator will resume the execution when all sub-workflows complete
        # When resumed, this function will be called again and all workflows should have completed
        from ..features.wait import WaitException

        workflow_ids = [w.id for w in workflows]
        raise WaitException(f"Waiting for sub-workflows {workflow_ids} to complete")

    async def agent_invoke(
        self,
        step_key: str,
        config: Any,
    ) -> ExecutionHandle:
        """
        Invoke a single agent as a workflow step without waiting for completion.

        This is designed to be used with Agent.with_input(), which returns
        an AgentRunConfig instance.

        Args:
            step_key: Step key identifier (must be unique per execution)
            config: AgentRunConfig instance
        """
        from ..agents.agent import AgentRunConfig  # Local import to avoid circular dependency

        if not isinstance(config, AgentRunConfig):
            raise StepExecutionError(
                f"agent_invoke expects an AgentRunConfig, got {type(config).__name__}"
            )

        payload = {
            "input": config.input,
            "streaming": config.streaming,
            "session_id": self.ctx.session_id,
            "user_id": self.ctx.user_id,
            "conversation_id": config.conversation_id**config.kwargs,
        }

        workflow_obj = get_workflow(config.agent.id)
        if not workflow_obj:
            raise StepExecutionError(f"Agent workflow '{config.agent.id}' not found")

        result, found = await self._invoke(
            step_key,
            workflow_obj,
            serialize(payload),
            initial_state=serialize(config.initial_state),
            wait_for_subworkflow=False,
            run_timeout_seconds=config.run_timeout_seconds,
        )
        return result

    async def agent_invoke_and_wait(
        self,
        step_key: str,
        config: Any,
    ) -> Any:
        """
        Invoke a single agent as a workflow step and wait for completion.

        This is designed to be used with Agent.with_input(), which returns
        an AgentRunConfig instance. The returned value is whatever the
        underlying agent workflow returns (typically an AgentResult).

        Args:
            step_key: Step key identifier (must be unique per execution)
            config: AgentRunConfig instance
        """
        from ..agents.agent import AgentRunConfig  # Local import to avoid circular dependency

        if not isinstance(config, AgentRunConfig):
            raise StepExecutionError(
                f"agent_invoke_and_wait expects an AgentRunConfig, got {type(config).__name__}"
            )

        payload = {
            "input": config.input,
            "streaming": config.streaming,
            "session_id": self.ctx.session_id,
            "user_id": self.ctx.user_id,
            "conversation_id": config.conversation_id,
            **config.kwargs,
        }

        workflow_obj = get_workflow(config.agent.id)
        if not workflow_obj:
            raise StepExecutionError(f"Agent workflow '{config.agent.id}' not found")

        result, found = await self._invoke(
            step_key,
            workflow_obj,
            serialize(payload),
            initial_state=serialize(config.initial_state),
            wait_for_subworkflow=True,
            run_timeout_seconds=config.run_timeout_seconds,
        )
        if found:
            # Step is complete, return result
            from ..types import AgentResult

            if isinstance(result, AgentResult):
                deserialized_result = await deserialize(result.result, result.result_schema)
                result.result = deserialized_result
            return result

        # Step did not exist yet; raise WaitException to pause execution
        from ..features.wait import WaitException

        raise WaitException(f"Waiting for agent workflow '{config.agent.id}' to complete")

    async def batch_agent_invoke(
        self,
        step_key: str,
        configs: list[Any],
    ) -> list[ExecutionHandle]:
        """
        Invoke multiple agents in parallel as a single workflow step.

        This is designed to be used with Agent.with_input(), which returns
        AgentRunConfig instances.
        """
        from ..agents.agent import AgentRunConfig  # Local import to avoid circular dependency

        workflows: list[BatchWorkflowInput] = []
        for config in configs:
            if not isinstance(config, AgentRunConfig):
                raise StepExecutionError(
                    f"batch_agent_invoke expects AgentRunConfig instances, "
                    f"got {type(config).__name__}"
                )
            payload = {
                "input": config.input,
                "streaming": config.streaming,
                "session_id": self.ctx.session_id,
                "user_id": self.ctx.user_id,
                "conversation_id": config.conversation_id,
                **config.kwargs,
            }
            workflows.append(
                BatchWorkflowInput(
                    id=config.agent.id,
                    payload=payload,
                    initial_state=config.initial_state,
                    run_timeout_seconds=config.run_timeout_seconds,
                )
            )

        return await self.batch_invoke(step_key, workflows)

    async def batch_agent_invoke_and_wait(
        self,
        step_key: str,
        configs: list[Any],
    ) -> list[BatchStepResult]:
        """
        Invoke multiple agents in parallel as a single workflow step and wait for all to complete.

        This is designed to be used with Agent.with_input(), which returns
        AgentRunConfig instances. The results are returned as BatchStepResult,
        where each .result is the AgentResult from the corresponding agent.
        """
        from ..agents.agent import AgentRunConfig  # Local import to avoid circular dependency

        workflows: list[BatchWorkflowInput] = []
        for config in configs:
            if not isinstance(config, AgentRunConfig):
                raise StepExecutionError(
                    f"batch_agent_invoke_and_wait expects AgentRunConfig instances, "
                    f"got {type(config).__name__}"
                )
            payload = {
                "input": config.input,
                "streaming": config.streaming,
                "session_id": self.ctx.session_id,
                "user_id": self.ctx.user_id,
                "conversation_id": config.conversation_id,
                **config.kwargs,
            }
            workflows.append(
                BatchWorkflowInput(
                    id=config.agent.id,
                    payload=payload,
                    initial_state=config.initial_state,
                    run_timeout_seconds=config.run_timeout_seconds,
                )
            )

        return await self.batch_invoke_and_wait(step_key, workflows)

    async def uuid(self, step_key: str) -> str:
        """Get a UUID that is persisted across workflow runs.

        On the first execution, generates a new UUID and saves it.
        On subsequent executions (replay/resume), returns the same UUID.

        Args:
            step_key: Step key identifier (must be unique per execution)

        Returns:
            UUID string (persisted across runs)
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            return await self._handle_existing_step(existing_step)

        # Generate new UUID
        generated_uuid = str(uuid_module.uuid4())

        # Save the UUID
        await self._save_step_output(step_key, generated_uuid)

        return generated_uuid

    async def now(self, step_key: str) -> int:
        """Get current timestamp in milliseconds (durable across runs).

        Args:
            step_key: Step key identifier (must be unique per execution)

        Returns:
            Current timestamp in milliseconds since epoch
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            return existing_step.get("outputs", int(time.time() * 1000))

        # Generate new timestamp
        timestamp = int(time.time() * 1000)

        # Save step output
        await self._save_step_output(step_key, timestamp)

        return timestamp

    async def random(self, step_key: str) -> float:
        """Get a random float between 0.0 and 1.0 that is persisted across workflow runs.

        On the first execution, generates a new random number and saves it.
        On subsequent executions (replay/resume), returns the same random number.

        Args:
            step_key: Step key identifier (must be unique per execution)

        Returns:
            Random float between 0.0 and 1.0 (persisted across runs)
        """
        # Check for existing step output
        existing_step = await self._check_existing_step(step_key)
        if existing_step:
            return await self._handle_existing_step(existing_step)

        # Generate new random number
        random_value = random_module.random()

        # Save the random number
        await self._save_step_output(step_key, random_value)

        return random_value

    @contextmanager
    def trace(self, name: str, attributes: dict[str, Any] | None = None):
        """Create a custom span within the current step execution.

        Args:
            name: Name of the span
            attributes: Optional dictionary of span attributes

        Returns:
            Context manager for use in 'with' statement

        Example:
            async def my_step(ctx):
                with ctx.step.trace("database_query", {"table": "users"}):
                    result = await db.query("SELECT * FROM users")
                return result
        """
        # Use the current OpenTelemetry span as parent (which should be the step/workflow span)
        # This ensures proper parent-child relationship within the same trace
        exec_context = _execution_context.get()
        tracer = get_tracer()
        parent_context = get_parent_span_context_from_execution_context(exec_context)

        # Create span using context manager
        with tracer.start_as_current_span(
            name=name, context=parent_context, attributes=attributes or {}
        ) as span:
            # Update execution context with current span for nested spans
            # Save old values to restore later
            old_span_context = get_span_context_from_execution_context(exec_context)
            set_span_context_in_execution_context(exec_context, span.get_span_context())

            try:
                yield span
                # Set status to success
                span.set_status(Status(StatusCode.OK))
                # Span automatically ended and stored by DatabaseSpanExporter
            except Exception as e:
                # Set status to error
                span.set_status(Status(StatusCode.ERROR, str(e)))
                span.record_exception(e)
                # Span automatically ended and stored by DatabaseSpanExporter
                raise
            finally:
                # Restore previous span context
                set_span_context_in_execution_context(exec_context, old_span_context)
                # Span context automatically cleaned up by context manager
