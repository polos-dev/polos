from __future__ import annotations

import asyncio
import inspect
import json
import logging
import time
from collections.abc import Callable
from contextvars import ContextVar
from typing import Any, Union

from pydantic import BaseModel

from ..features.tracing import (
    create_context_from_traceparent,
    create_context_with_trace_id,
    generate_trace_id_from_execution_id,
    get_tracer,
)
from ..features.wait import WaitException
from ..runtime.client import ExecutionHandle, PolosClient
from ..runtime.queue import Queue
from ..utils.serializer import safe_serialize, serialize
from .context import AgentContext, WorkflowContext

# Import OpenTelemetry types
try:
    from opentelemetry import trace
    from opentelemetry.trace import Status, StatusCode
except ImportError:
    # Fallback if OpenTelemetry not available
    class Status:
        def __init__(self, code, description=None):
            self.code = code
            self.description = description

    class StatusCode:
        OK = "OK"
        ERROR = "ERROR"

    trace = None

logger = logging.getLogger(__name__)

# Global registry of workflows
_WORKFLOW_REGISTRY: dict[str, Workflow] = {}

# Context variables for tracking execution state
_execution_context: ContextVar[dict[str, Any] | None] = ContextVar(
    "execution_context", default=None
)


class StepExecutionError(Exception):
    """
    Exception raised a step fails and the workflow must fail.
    """

    def __init__(self, reason: str | None = None):
        self.reason = reason
        super().__init__(reason)


class WorkflowTimeoutError(Exception):
    """
    Exception raised when a workflow/agent/tool execution times out.
    """

    def __init__(self, execution_id: str | None = None, timeout_seconds: float | None = None):
        self.execution_id = execution_id
        self.timeout_seconds = timeout_seconds
        message = f"Execution timed out after {timeout_seconds} seconds"
        if execution_id:
            message += f" (execution_id: {execution_id})"
        super().__init__(message)


class Workflow:
    def __init__(
        self,
        id: str,
        func: Callable,
        description: str | None = None,  # Description for team coordination
        workflow_type: str | None = "workflow",
        queue_name: str | None = None,
        queue_concurrency_limit: int | None = None,
        trigger_on_event: str | None = None,
        batch_size: int = 1,
        batch_timeout_seconds: int | None = None,
        schedule: bool | str | dict[str, Any] | None = None,
        on_start: str | list[str] | Any | list[Any] | None = None,
        on_end: str | list[str] | Any | list[Any] | None = None,
        payload_schema_class: type[BaseModel] | None = None,
        output_schema: type[BaseModel] | None = None,
        state_schema: type[BaseModel] | None = None,
    ):
        self.id = id
        self.description = description  # Description for team coordination
        self.func = func
        self.is_async = asyncio.iscoroutinefunction(func)
        # Check if function has a payload parameter
        sig = inspect.signature(func)
        params = list(sig.parameters.values())
        self.has_payload_param = len(params) >= 2

        # Store payload schema class (extracted during decorator validation)
        self._payload_schema_class = payload_schema_class

        # If not provided by decorator, try to extract it (fallback for manual Workflow creation)
        if self.has_payload_param and self._payload_schema_class is None:
            second_param = params[1]
            second_annotation = second_param.annotation

            # Handle string annotations (forward references)
            if isinstance(second_annotation, str):
                # Try to resolve the annotation
                try:
                    # Import from the function's module
                    func_module = inspect.getmodule(func)
                    if func_module:
                        # Try to evaluate the annotation in the function's module context
                        second_annotation = eval(second_annotation, func_module.__dict__)
                except (NameError, AttributeError, SyntaxError):
                    pass

            # Check if it's a Pydantic BaseModel subclass
            if inspect.isclass(second_annotation) and issubclass(second_annotation, BaseModel):
                self._payload_schema_class = second_annotation
            elif hasattr(second_annotation, "__origin__"):
                # Check if it's a Union type containing a BaseModel
                origin = getattr(second_annotation, "__origin__", None)
                if origin is Union or (hasattr(origin, "__name__") and origin.__name__ == "Union"):
                    args = getattr(second_annotation, "__args__", ())
                    for arg in args:
                        if inspect.isclass(arg) and issubclass(arg, BaseModel):
                            # Prefer the BaseModel over dict if both are present
                            self._payload_schema_class = arg
                            break

        self.workflow_type = workflow_type
        self.state_schema = state_schema
        self.queue_name = queue_name  # None means use workflow_id as queue name
        self.queue_concurrency_limit = queue_concurrency_limit
        self.trigger_on_event = trigger_on_event  # Event topic that triggers this workflow
        self.batch_size = batch_size  # Max number of events to batch together
        self.batch_timeout_seconds = batch_timeout_seconds  # Max time to wait for batching
        # Parse schedule configuration
        # schedule can be: True (schedulable), False (not schedulable),
        # cron string, or dict with cron/timezone
        self.schedule = schedule
        self.is_schedulable = (
            False  # Whether this workflow can be scheduled (schedule=True or has cron)
        )

        if schedule is True:
            self.is_schedulable = True
        elif schedule is False:
            self.is_schedulable = False
        elif schedule is not None:
            # schedule is a cron string or dict - workflow is schedulable and has a default schedule
            self.is_schedulable = True

        # Scheduled workflows cannot be event-triggered
        if schedule and trigger_on_event:
            raise ValueError("Workflows cannot be both scheduled and event-triggered")

        # Scheduled workflows cannot specify queues - they get their own queue with concurrency=1
        if self.is_schedulable and (queue_name is not None or queue_concurrency_limit is not None):
            raise ValueError("Scheduled workflows cannot specify a queue or concurrency limit")

        # Lifecycle hooks - normalize to list of callables
        self.on_start = self._normalize_hooks(on_start)
        self.on_end = self._normalize_hooks(on_end)

        # Output schema class (can be set in constructor or after execution
        # if result is a Pydantic model)
        self.output_schema: type[BaseModel] | None = output_schema

    def _prepare_payload(self, payload: BaseModel | dict[str, Any] | None) -> dict[str, Any] | None:
        """
        Validate and normalize payload for submission to the orchestrator.

        Rules:
        - If payload is None, return None
        - If payload is a Pydantic BaseModel instance, convert to dict via model_dump(mode="json")
        - If payload is a dict, ensure it is JSON serializable via json.dumps()
        - Otherwise, raise TypeError
        """
        if payload is None:
            return None

        # Pydantic model → dict
        if isinstance(payload, BaseModel):
            return payload.model_dump(mode="json")

        # Require dict[str, Any] for non-Pydantic payloads
        if isinstance(payload, dict):
            try:
                # Validate JSON serializability of the dict
                json.dumps(payload)
            except (TypeError, ValueError) as e:
                raise TypeError(
                    f"Workflow '{self.id}' payload dict is not JSON serializable: {e}. "
                    f"Consider using a Pydantic BaseModel for structured data."
                ) from e
            return payload

        raise TypeError(
            f"Workflow '{self.id}' payload must be a dict or Pydantic BaseModel instance, "
            f"got {type(payload).__name__}."
        )

    def _normalize_hooks(self, hooks: Callable | list[Callable] | None) -> list[Callable]:
        """Normalize hooks to a list of callables.

        Accepts:
        - None: Returns empty list
        - Callable: Single hook callable
        - List[Callable]: List of hook callables
        """

        if hooks is None:
            return []
        if callable(hooks):
            return [hooks]
        if isinstance(hooks, list):
            result = []
            for hook in hooks:
                if callable(hook):
                    result.append(hook)
                else:
                    raise TypeError(
                        f"Invalid hook type: {type(hook)}. Expected a callable "
                        f"(function decorated with @hook)."
                    )
            return result
        raise TypeError(f"Invalid hooks type: {type(hooks)}. Expected callable or List[callable].")

    async def _execute(self, context: dict[str, Any], payload: Any) -> Any:
        """Execute the workflow with the given payload and checkpointing."""
        execution_id = context.get("execution_id")
        deployment_id = context.get("deployment_id")
        parent_execution_id = context.get("parent_execution_id")
        root_execution_id = context.get("root_execution_id")
        retry_count = context.get("retry_count", 0)
        created_at = context.get("created_at")
        session_id = context.get("session_id")
        user_id = context.get("user_id")
        root_workflow_id = context.get("root_workflow_id")
        otel_traceparent = context.get("otel_traceparent")
        otel_span_id = context.get("otel_span_id")
        cancel_event = context.get("cancel_event")
        sandbox_manager = context.get("sandbox_manager")
        channels = context.get("channels")
        channel_context_data = context.get("channel_context")

        # Ensure execution_id is a string
        if execution_id:
            execution_id = str(execution_id)
        if deployment_id:
            deployment_id = str(deployment_id)
        if parent_execution_id:
            parent_execution_id = str(parent_execution_id)
        if root_execution_id:
            root_execution_id = str(root_execution_id)
        if retry_count:
            retry_count = int(retry_count)
        if session_id:
            session_id = str(session_id)
        if user_id:
            user_id = str(user_id)

        # Set execution context for this workflow execution
        # If we have root_execution_id, use it; otherwise, we are the root
        effective_root_execution_id = root_execution_id if root_execution_id else execution_id

        # Get initial_state from context if provided
        initial_state = context.get("initial_state")
        if initial_state:
            initial_state = self.state_schema.model_validate(initial_state)

        # Parse channel_context from raw dict (sent by orchestrator)
        channel_context = None
        if channel_context_data and isinstance(channel_context_data, dict):
            from ..channels.channel import ChannelContext

            channel_context = ChannelContext(
                channel_id=channel_context_data.get("channel_id", ""),
                source=channel_context_data.get("source", {}),
            )

        # Check if this is an Agent and create appropriate context
        from ..agents.agent import Agent

        if isinstance(self, Agent):
            # Create AgentContext for agents
            workflow_ctx = AgentContext(
                agent_id=self.id,
                execution_id=execution_id,
                deployment_id=deployment_id,
                parent_execution_id=parent_execution_id,
                root_execution_id=effective_root_execution_id,
                root_workflow_id=root_workflow_id,
                retry_count=retry_count,
                model=self.model,
                provider=self.provider,
                system_prompt=self.system_prompt,
                tools=self.tools,
                temperature=self.temperature,
                max_tokens=self.max_output_tokens,
                session_id=session_id,
                user_id=user_id,
                created_at=created_at,
                otel_traceparent=otel_traceparent,
                otel_span_id=otel_span_id,
                state_schema=self.state_schema,
                initial_state=initial_state,
                cancel_event=cancel_event,
                channels=channels,
                channel_context=channel_context,
            )
        else:
            # Create WorkflowContext for regular workflows or tools
            from ..tools.tool import Tool

            workflow_type = "tool" if isinstance(self, Tool) else "workflow"

            workflow_ctx = WorkflowContext(
                workflow_id=self.id,
                execution_id=execution_id,
                deployment_id=deployment_id,
                parent_execution_id=parent_execution_id,
                root_execution_id=effective_root_execution_id,
                root_workflow_id=root_workflow_id,
                retry_count=retry_count,
                created_at=created_at,
                session_id=session_id,
                user_id=user_id,
                workflow_type=workflow_type,
                otel_traceparent=otel_traceparent,
                otel_span_id=otel_span_id,
                state_schema=self.state_schema,
                initial_state=initial_state,
                cancel_event=cancel_event,
                channels=channels,
                channel_context=channel_context,
            )

        # Convert dict payload to Pydantic model if needed
        prepared_payload = payload
        if self.has_payload_param and self._payload_schema_class is not None:
            if isinstance(payload, dict):
                # Convert dict to Pydantic model
                try:
                    prepared_payload = self._payload_schema_class.model_validate(payload)
                except Exception as e:
                    raise ValueError(
                        f"Invalid payload for workflow '{self.id}': failed to "
                        f"validate against {self._payload_schema_class.__name__}: {e}"
                    ) from e
            elif payload is not None and not isinstance(payload, self._payload_schema_class):
                # Payload is provided but not the right type
                raise ValueError(
                    f"Invalid payload for workflow '{self.id}': "
                    f"expected {self._payload_schema_class.__name__} or dict, "
                    f"got {type(payload).__name__}"
                )

        return await self._execute_internal(workflow_ctx, prepared_payload, sandbox_manager)

    async def _execute_internal(
        self, ctx: WorkflowContext, payload: Any, sandbox_manager: Any = None
    ) -> Any:
        """Internal execution method with shared logic for workflows and agents.

        This method handles:
        - Checking execution_step_outputs for replay
        - Setting up execution context cache
        - Publishing start event
        - Executing on_start hooks
        - Calling the workflow/agent function
        - Executing on_end hooks
        - Publishing finish event
        - Handling WaitException
        """
        from ..middleware.hook import HookAction, HookContext
        from ..middleware.hook_executor import execute_hooks

        # Determine span name based on workflow type
        workflow_type = ctx.workflow_type or "workflow"
        span_name = f"{workflow_type}.{ctx.workflow_id}"

        traceparent = ctx.otel_traceparent

        # Get parent context for sub-workflows, or create deterministic trace ID for root
        parent_context = None
        if traceparent:
            # Sub-workflow: use parent's trace context
            parent_context = create_context_from_traceparent(traceparent)
            if parent_context is None:
                logger.warning(
                    "Failed to extract trace context from traceparent: %s. Creating new trace.",
                    traceparent,
                )
                # Fall back to deterministic trace ID if extraction fails
                trace_id = generate_trace_id_from_execution_id(
                    ctx.root_execution_id or ctx.execution_id
                )
                parent_context = create_context_with_trace_id(trace_id)
        else:
            # Root workflow: create deterministic trace ID from root_execution_id
            trace_id = generate_trace_id_from_execution_id(
                ctx.root_execution_id or ctx.execution_id
            )
            parent_context = create_context_with_trace_id(trace_id)

        # Create root span for workflow execution using context manager
        tracer = get_tracer()
        span_attributes = {
            f"{workflow_type}.id": ctx.workflow_id,
            f"{workflow_type}.execution_id": ctx.execution_id,
            f"{workflow_type}.parent_execution_id": ctx.parent_execution_id or "",
            f"{workflow_type}.root_execution_id": ctx.root_execution_id or ctx.execution_id,
            f"{workflow_type}.deployment_id": ctx.deployment_id,
            f"{workflow_type}.type": workflow_type,
            f"{workflow_type}.session_id": ctx.session_id or "",
            f"{workflow_type}.user_id": ctx.user_id or "",
            f"{workflow_type}.retry_count": ctx.retry_count or 0,
        }

        # If this is a resumed workflow, add previous_span_id attribute
        if ctx.otel_span_id:
            span_attributes[f"{workflow_type}.previous_span_id"] = ctx.otel_span_id

        # For root workflows with deterministic trace_id, we need to attach the context
        # so the IdGenerator can access it. For sub-workflows, we use context parameter.
        context_token = None
        if parent_context and not traceparent:
            # Root workflow: attach context so IdGenerator can read trace_id
            from opentelemetry import context as otel_context

            context_token = otel_context.attach(parent_context)

        with tracer.start_as_current_span(
            name=span_name,
            context=parent_context
            if traceparent
            else None,  # For sub-workflows, pass context; for root, rely on attached context
            attributes=span_attributes,
        ) as workflow_span:
            # If this is a resumed workflow, add resumed event
            if ctx.otel_span_id:
                workflow_span.add_event(f"{workflow_type}.resumed")
            # Update execution context with current span for nested spans
            exec_context = ctx.to_dict()
            span_context = workflow_span.get_span_context()
            exec_context["_otel_span_context"] = span_context
            exec_context["_otel_trace_id"] = format(span_context.trace_id, "032x")
            exec_context["_otel_span_id"] = format(span_context.span_id, "016x")
            exec_context["state"] = ctx.state  # Store workflow_ctx for worker to access final_state
            if sandbox_manager is not None:
                exec_context["sandbox_manager"] = sandbox_manager
            token = _execution_context.set(exec_context)

            # Topic for workflow events
            topic = f"workflow/{ctx.root_workflow_id}/{ctx.root_execution_id}"

            serialized_payload = serialize(payload) if payload is not None else None

            # Store input in span attributes as JSON string
            if payload is not None:
                workflow_span.set_attribute(
                    f"{workflow_type}.input", json.dumps(serialized_payload)
                )

            # Store initial state in span if provided
            if ctx.state is not None and self.state_schema:
                try:
                    initial_state_dict = ctx.state.model_dump(mode="json")
                    workflow_span.set_attribute(
                        f"{workflow_type}.initial_state", json.dumps(initial_state_dict)
                    )
                except Exception as e:
                    logger.warning(f"Failed to serialize initial state for span: {e}")

            try:
                # Publish start event
                await ctx.step.publish_event(
                    "publish_start",
                    topic=topic,
                    event_type=f"{workflow_type}_start",
                    data={
                        "payload": serialized_payload,
                        "_metadata": {
                            "execution_id": ctx.execution_id,
                            "workflow_id": ctx.workflow_id,
                        },
                    },
                )

                # Execute on_start hooks
                if self.on_start:
                    hook_context = HookContext(
                        workflow_id=self.id,
                        current_payload=payload,
                    )
                    hook_result = await execute_hooks("on_start", self.on_start, hook_context, ctx)

                    # Apply modifications from hooks
                    if hook_result.modified_payload is not None:
                        payload = hook_result.modified_payload

                    # Check hook action
                    if hook_result.action == HookAction.FAIL:
                        raise StepExecutionError(
                            hook_result.error_message or "Hook execution failed"
                        )

                # Call the workflow/agent function with context and payload (if function expects it)
                if self.is_async:
                    if self.has_payload_param:
                        result = await self.func(ctx, payload)
                    else:
                        result = await self.func(ctx)
                else:
                    # Run sync function in executor to avoid blocking
                    loop = asyncio.get_event_loop()
                    if self.has_payload_param:
                        result = await loop.run_in_executor(None, self.func, ctx, payload)
                    else:
                        result = await loop.run_in_executor(None, self.func, ctx)

                # Execute on_end hooks
                if self.on_end:
                    hook_context = HookContext(
                        workflow_id=self.id,
                        current_payload=payload,
                        current_output=result,
                    )
                    hook_result = await execute_hooks("on_end", self.on_end, hook_context, ctx)

                    # Apply modifications from hooks
                    if hook_result.modified_output is not None:
                        result = hook_result.modified_output

                    # Check hook action
                    if hook_result.action == HookAction.FAIL:
                        raise StepExecutionError(
                            hook_result.error_message or "Hook execution failed"
                        )

                serialized_result = serialize(result) if result is not None else None
                # Publish finish event (only if we didn't hit WaitException)
                await ctx.step.publish_event(
                    "publish_finish",
                    topic=topic,
                    event_type=f"{workflow_type}_finish",
                    data={
                        "result": serialized_result,
                        "_metadata": {
                            "execution_id": ctx.execution_id,
                            "workflow_id": ctx.workflow_id,
                        },
                    },
                )

                # Set span status to success
                workflow_span.set_status(Status(StatusCode.OK))
                workflow_span.set_attribute(f"{workflow_type}.status", "completed")
                workflow_span.set_attribute(
                    f"{workflow_type}.result_size", len(str(result)) if result else 0
                )
                # Store output in span attributes as JSON string
                if result is not None:
                    workflow_span.set_attribute(
                        f"{workflow_type}.output", json.dumps(serialized_result)
                    )

                final_state = None
                # Store final state in span if workflow has state_schema
                if ctx.state is not None and self.state_schema:
                    try:
                        final_state = ctx.state.model_dump(mode="json")
                        workflow_span.set_attribute(
                            f"{workflow_type}.final_state", json.dumps(final_state)
                        )
                    except Exception as e:
                        logger.warning(f"Failed to serialize final state for span: {e}")

                # Span automatically ended and stored by DatabaseSpanExporter
                # when context manager exits
                return result, final_state
            except WaitException:
                # Execution is paused for waiting - this is expected
                # The orchestrator will resume it when the wait expires
                # Do NOT publish finish event when WaitException is raised
                workflow_span.set_status(Status(StatusCode.OK))
                workflow_span.set_attribute(f"{workflow_type}.status", "waiting")
                workflow_span.add_event(f"{workflow_type}.waiting")

                # Save current span_id to database for resume linkage
                span_context = workflow_span.get_span_context()
                span_id_hex = format(span_context.span_id, "016x")
                from ..runtime.client import update_execution_otel_span_id

                try:
                    # Schedule the update as a background task (don't await to avoid blocking)
                    asyncio.create_task(
                        update_execution_otel_span_id(ctx.execution_id, span_id_hex)
                    )
                except Exception as e:
                    # Log error but don't fail on span_id update failure
                    logger.warning(
                        f"Failed to update otel_span_id for execution {ctx.execution_id}: {e}"
                    )

                # Span automatically ended and stored by DatabaseSpanExporter
                # when context manager exits
                raise

            except Exception as e:
                # Set span status to error
                workflow_span.set_status(Status(StatusCode.ERROR, str(e)))
                workflow_span.set_attribute(f"{workflow_type}.status", "failed")
                workflow_span.record_exception(e)

                # Store error in span attributes as JSON string
                error_message = str(e)
                workflow_error = {
                    "message": error_message,
                    "type": type(e).__name__,
                }
                workflow_span.set_attribute(
                    f"{workflow_type}.error", json.dumps(safe_serialize(workflow_error))
                )

                final_state = None
                if ctx.state is not None and self.state_schema:
                    try:
                        final_state = ctx.state.model_dump(mode="json")
                        workflow_span.set_attribute(
                            f"{workflow_type}.final_state", json.dumps(final_state)
                        )
                    except Exception as e2:
                        logger.warning(f"Failed to serialize final state for error case: {e2}")

                # Span automatically ended and stored by DatabaseSpanExporter
                # when context manager exits
                raise

            finally:
                # Restore previous context
                _execution_context.reset(token)
                # Detach OTel context if we attached it for root workflows
                if context_token is not None:
                    from opentelemetry import context as otel_context

                    otel_context.detach(context_token)
                # Span context automatically cleaned up by context manager

    async def invoke(
        self,
        client: PolosClient,
        payload: BaseModel | dict[str, Any] | None = None,
        queue: str | None = None,
        concurrency_key: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        initial_state: BaseModel | dict[str, Any] | None = None,
        run_timeout_seconds: int | None = None,
    ) -> ExecutionHandle:
        """Invoke workflow execution via orchestrator and return a handle immediately.

        This is a fire-and-forget operation.
        The workflow will be executed asynchronously and the handle will be returned immediately.
        This workflow cannot be called from within a workflow or agent.
        Use step.invoke() to call workflows from within workflows.

        Args:
            client: PolosClient instance
            payload: Workflow payload
            queue: Optional queue name (overrides workflow-level queue)
            concurrency_key: Optional concurrency key for per-tenant queuing
            session_id: Optional session ID (inherited from parent if not provided)
            user_id: Optional user ID (inherited from parent if not provided)

        Returns:
            ExecutionHandle for monitoring and managing the execution

        Raises:
            ValueError: If workflow is event-triggered (cannot be invoked directly)
        """
        # Check if we're in an execution context - fail if we are
        if _execution_context.get() is not None:
            raise RuntimeError(
                "workflow.run() cannot be called from within a workflow or agent. "
                "Use step.invoke() to call workflows from within workflows."
            )

        return await self._invoke(
            client,
            payload,
            queue=queue,
            concurrency_key=concurrency_key,
            session_id=session_id,
            user_id=user_id,
            initial_state=initial_state,
            run_timeout_seconds=run_timeout_seconds,
        )

    async def _invoke(
        self,
        client: PolosClient,
        payload: BaseModel | dict[str, Any] | None = None,
        queue: str | None = None,
        concurrency_key: str | None = None,
        batch_id: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        deployment_id: str | None = None,
        parent_execution_id: str | None = None,
        root_workflow_id: str | None = None,
        root_execution_id: str | None = None,
        step_key: str | None = None,
        wait_for_subworkflow: bool = False,
        otel_traceparent: str | None = None,
        initial_state: BaseModel | dict[str, Any] | None = None,
        run_timeout_seconds: int | None = None,
        channel_context: dict[str, Any] | None = None,
    ) -> ExecutionHandle:
        """Invoke workflow execution via orchestrator and return a handle immediately.

        This is a fire-and-forget operation.
        The workflow will be executed asynchronously and the handle will be returned immediately.

        Args:
            client: PolosClient instance
            payload: Workflow payload
            queue: Optional queue name (overrides workflow-level queue)
            concurrency_key: Optional concurrency key for per-tenant queuing
            batch_id: Optional batch ID for batching
            session_id: Optional session ID (inherited from parent if not provided)
            user_id: Optional user ID (inherited from parent if not provided)
            step_key: Optional step_key (set when invoked from step.py)

        Returns:
            ExecutionHandle for monitoring and managing the execution
        """

        if self.trigger_on_event and (payload is None or payload.get("events") is None):
            raise ValueError(
                f"Workflow '{self.id}' is event-triggered and should have events in the payload."
            )

        # Validate and normalize payload (dict or Pydantic BaseModel only)
        # Only prepare payload if workflow expects it
        if self.has_payload_param:
            if payload is None:
                raise ValueError(
                    f"Workflow '{self.id}' requires a payload parameter, but None was provided"
                )
            # payload = self._prepare_payload(payload)
            payload = serialize(payload)
        else:
            # Workflow doesn't expect payload - ignore it if provided
            if payload is not None:
                # Warn but don't fail - user might be calling with payload by mistake
                pass
            payload = None

        # Default root_workflow_id to self.id if not provided (top-level invocation)
        if not root_workflow_id:
            root_workflow_id = self.id

        # Invoke the workflow (it will be checkpointed when it executes)
        # For nested workflows called via step.invoke(), use workflow's own queue configuration
        queue_name = queue if queue else self.queue_name if self.queue_name is not None else self.id
        handle = await client._submit_workflow(
            self.id,
            payload,
            deployment_id=deployment_id,
            parent_execution_id=parent_execution_id,
            root_workflow_id=root_workflow_id,
            root_execution_id=root_execution_id,
            step_key=step_key,
            queue_name=queue_name,
            queue_concurrency_limit=self.queue_concurrency_limit,
            concurrency_key=concurrency_key,
            wait_for_subworkflow=wait_for_subworkflow,
            batch_id=batch_id,
            session_id=session_id,
            user_id=user_id,
            otel_traceparent=otel_traceparent,
            initial_state=serialize(initial_state),
            run_timeout_seconds=run_timeout_seconds,
            channel_context=channel_context,
        )
        return handle

    async def run(
        self,
        client: PolosClient,
        payload: BaseModel | dict[str, Any] | None = None,
        queue: str | None = None,
        concurrency_key: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        timeout: float | None = 600.0,
        initial_state: BaseModel | dict[str, Any] | None = None,
    ) -> Any:
        """
        Run workflow and return final result (wait for completion).

        This method cannot be called from within an execution context
        (e.g., from within a workflow).
        Use step.invoke_and_wait() to call workflows from within workflows.

        Args:
            client: PolosClient instance
            payload: Workflow payload (dict or Pydantic BaseModel)
            queue: Optional queue name (overrides workflow-level queue)
            concurrency_key: Optional concurrency key for per-tenant queuing
            session_id: Optional session ID
            user_id: Optional user ID
            timeout: Optional timeout in seconds (default: 600 seconds / 10 minutes)

        Returns:
            Result from workflow execution

        Raises:
            WorkflowTimeoutError: If the execution exceeds the timeout

        Example:
            result = await my_workflow.run({"param": "value"})
        """
        # Check if we're in an execution context - fail if we are
        if _execution_context.get() is not None:
            raise RuntimeError(
                "workflow.run() cannot be called from within a workflow or agent. "
                "Use step.invoke_and_wait() to call workflows from within workflows."
            )

        # Invoke workflow and get handle
        handle = await self.invoke(
            client=client,
            payload=payload,
            queue=queue,
            concurrency_key=concurrency_key,
            session_id=session_id,
            user_id=user_id,
            initial_state=initial_state,
            run_timeout_seconds=int(timeout),
        )

        # Track start time for timeout
        start_time = time.time()

        # Poll handle.get() until status is "completed" or "failed"
        while True:
            # Check for timeout
            elapsed_time = time.time() - start_time
            if elapsed_time >= timeout:
                raise WorkflowTimeoutError(
                    execution_id=handle.id if hasattr(handle, "id") else None,
                    timeout_seconds=timeout,
                )

            execution_info = await handle.get(client)
            status = execution_info.get("status")

            if status == "completed":
                result = execution_info.get("result")
                break
            elif status == "failed":
                error = execution_info.get("error", "Workflow execution failed")
                raise RuntimeError(f"Workflow execution failed: {error}")

            # Wait before checking again
            await asyncio.sleep(0.5)

        return result


def workflow(
    id: str | None = None,
    description: str | None = None,  # Description for team coordination
    queue: str | Queue | dict[str, Any] | None = None,
    trigger_on_event: str | None = None,
    batch_size: int = 1,
    batch_timeout_seconds: int | None = None,
    schedule: bool | str | dict[str, Any] | None = None,
    on_start: str | list[str] | Workflow | list[Workflow] | None = None,
    on_end: str | list[str] | Workflow | list[Workflow] | None = None,
    state_schema: type[BaseModel] | None = None,
):
    """Decorator to register a Polos workflow.

    Usage:
        @workflow
        def my_workflow(payload):
            return {"result": payload * 2}

        @workflow()
        def my_workflow2(payload):
            return {"result": payload * 2}

        @workflow(id="custom_workflow_id")
        async def async_workflow(payload):
            await asyncio.sleep(1)
            return {"done": True}

        # With inline queue config
        @workflow(queue={"concurrency_limit": 1})
        def one_at_a_time(payload):
            return {"result": payload}

        # With queue name
        @workflow(queue="my-queue")
        def my_queued_workflow(payload):
            return {"result": payload}

        # With Queue object
        from polos import queue
        my_queue = queue("my-queue", concurrency_limit=5)
        @workflow(queue=my_queue)
        def queued_workflow(payload):
            return {"result": payload}

        # Event-triggered workflow (one event per invocation)
        @workflow(id="on-approval-dept1", trigger_on_event="approval/dept1")
        async def on_approval_dept1(ctx, payload):
            # payload contains event information
            event_data = payload.get("events", [{}])[0]
            return {"processed": event_data}

        # Event-triggered workflow with batching (10 events per batch, 30 second timeout)
        @workflow(
            id="batch-processor",
            trigger_on_event="data/updates",
            batch_size=10,
            batch_timeout_seconds=30
        )
        async def batch_processor(ctx, payload):
            # payload contains batch of events
            events = payload.get("events", [])
            return {"processed_count": len(events)}

        # Scheduled workflow (declarative with cron)
        @workflow(id="daily-cleanup", schedule="0 3 * * *")
        async def daily_cleanup(ctx, payload):
            # payload is SchedulePayload
            print(f"Scheduled to run at {payload.timestamp}")
            return {"status": "cleaned"}

        # Scheduled workflow with timezone
        @workflow(
            id="morning-report",
            schedule={"cron": "0 8 * * *", "timezone": "America/New_York"}
        )
        async def morning_report(ctx, payload):
            return {"report": "generated"}

        # Workflow that can be scheduled later (schedule=True)
        @workflow(id="reminder-workflow", schedule=True)
        async def reminder_workflow(ctx, payload):
            # Schedule will be added later using schedules.create()
            return {"reminder": "sent"}

        # Workflow that cannot be scheduled (schedule=False)
        @workflow(id="one-time-workflow", schedule=False)
        async def one_time_workflow(ctx, payload):
            return {"done": True}

    Args:
        id: Optional workflow ID (defaults to function name)
        description: Optional description for team coordination. Used when this
            workflow is added to a Team so the coordinator LLM understands its purpose.
        queue: Optional queue configuration. Can be:
            - str: Queue name
            - Queue: Queue object
            - dict: {"concurrency_limit": int} (uses workflow_id as queue name)
            - None: Uses workflow_id as queue name with default concurrency
            - Note: Cannot be specified for event-triggered or scheduled workflows
        trigger_on_event: Optional event topic that triggers this workflow. If specified:
            - Workflow will be automatically triggered when events are published to this topic
            - Workflow gets its own queue with concurrency=1 (to ensure ordering)
            - Payload will contain event information:
              {"events": [{"id": "...", "topic": "...", "event_type": "...",
              "data": {...}, "sequence_id": ..., "created_at": "..."}, ...]}
        batch_size: For event-triggered workflows, number of events to batch
            together (default: 1)
        batch_timeout_seconds: For event-triggered workflows, max time to wait
            for batching (None = no timeout)
        schedule: Optional schedule configuration. Can be:
            - True: Workflow can be scheduled later using schedules.create() API
            - False: Workflow cannot be scheduled (explicit opt-out)
            - str: Cron expression (e.g., "0 3 * * *" for 3 AM daily,
              uses UTC timezone) - creates schedule immediately
            - dict: {"cron": str, "timezone": str, "key": str}
              (e.g., {"cron": "0 8 * * *", "timezone": "America/New_York"})
              - creates schedule immediately
            - Note: Cannot be specified for event-triggered workflows
            - Note: Scheduled workflows cannot specify queues
              (they get their own queue with concurrency=1)

    Workflow IDs must be valid Python identifiers (letters, numbers, underscores;
    cannot start with a number or be a Python keyword).
    """

    def decorator(func: Callable) -> Workflow:
        # Validate function signature
        sig = inspect.signature(func)
        params = list(sig.parameters.values())

        if len(params) < 1:
            raise TypeError(
                f"Workflow function '{func.__name__}' must have at least 1 "
                f"parameter: (context: WorkflowContext) or "
                f"(context: WorkflowContext, payload: "
                f"Union[BaseModel, dict[str, Any]])"
            )

        if len(params) > 2:
            raise TypeError(
                f"Workflow function '{func.__name__}' must have at most 2 "
                f"parameters: (context: WorkflowContext) or "
                f"(context: WorkflowContext, payload: "
                f"Union[BaseModel, dict[str, Any]])"
            )

        # Check first parameter (context)
        first_param = params[0]
        first_annotation = first_param.annotation

        # Allow untyped parameters or anything that ends with WorkflowContext/AgentContext
        first_type_valid = False
        if first_annotation == inspect.Parameter.empty:
            # Untyped is allowed
            first_type_valid = True
        elif isinstance(first_annotation, str):
            # String annotation - check if it ends with WorkflowContext or AgentContext
            if (
                first_annotation.endswith("WorkflowContext")
                or first_annotation.endswith("AgentContext")
                or "WorkflowContext" in first_annotation
                or "AgentContext" in first_annotation
            ):
                first_type_valid = True
        else:
            # Type annotation - check if class name ends with WorkflowContext or AgentContext
            try:
                # Get the class name
                type_name = getattr(first_annotation, "__name__", None) or str(first_annotation)
                if (
                    type_name.endswith("WorkflowContext")
                    or type_name.endswith("AgentContext")
                    or "WorkflowContext" in type_name
                    or "AgentContext" in type_name
                ):
                    first_type_valid = True
                # Also check if it's the actual WorkflowContext or AgentContext class
                from ..core.context import AgentContext, WorkflowContext

                if first_annotation in (WorkflowContext, AgentContext):
                    first_type_valid = True
                elif hasattr(first_annotation, "__origin__"):  # Handle Union, Optional, etc.
                    # For Union types, check if WorkflowContext or AgentContext is in the union
                    args = getattr(first_annotation, "__args__", ())
                    if WorkflowContext in args or AgentContext in args:
                        first_type_valid = True
            except (ImportError, AttributeError):
                # If we can't check, allow it if the name suggests it's
                # WorkflowContext or AgentContext
                type_name = getattr(first_annotation, "__name__", None) or str(first_annotation)
                if "WorkflowContext" in type_name or "AgentContext" in type_name:
                    first_type_valid = True

        if not first_type_valid:
            raise TypeError(
                f"Workflow function '{func.__name__}': first parameter "
                f"'{first_param.name}' must be typed as WorkflowContext or "
                f"AgentContext (or untyped), got {first_annotation}"
            )

        # Check second parameter (payload) if it exists
        payload_schema_class: type[BaseModel] | None = None
        if len(params) >= 2:
            second_param = params[1]
            second_annotation = second_param.annotation
            if second_annotation == inspect.Parameter.empty:
                raise TypeError(
                    f"Workflow function '{func.__name__}': second parameter "
                    f"'{second_param.name}' must be typed as "
                    f"Union[BaseModel, dict[str, Any]] or a specific "
                    f"Pydantic BaseModel class"
                )

            # Check if second parameter is dict[str, Any], BaseModel, or a Pydantic model
            second_type_valid = False
            if isinstance(second_annotation, str):
                # String annotation - check for dict, BaseModel, or Union
                if "dict" in second_annotation.lower() or "Dict" in second_annotation:
                    second_type_valid = True
                if "BaseModel" in second_annotation:
                    second_type_valid = True
                if "Union" in second_annotation or "|" in second_annotation:
                    second_type_valid = True
            else:
                # Actual type - check various cases
                try:
                    # Check if it's dict type
                    if second_annotation is dict or (
                        hasattr(second_annotation, "__origin__")
                        and getattr(second_annotation, "__origin__", None) is dict
                    ):
                        second_type_valid = True

                    # Check if it's BaseModel or a subclass
                    if (
                        issubclass(second_annotation, BaseModel)
                        if inspect.isclass(second_annotation)
                        else False
                    ):
                        second_type_valid = True
                        # Extract payload schema class for later use
                        payload_schema_class = second_annotation

                    # Check if it's a Union type containing dict or BaseModel
                    if hasattr(second_annotation, "__origin__"):
                        origin = getattr(second_annotation, "__origin__", None)
                        if origin is Union or (
                            hasattr(origin, "__name__") and origin.__name__ == "Union"
                        ):
                            args = getattr(second_annotation, "__args__", ())
                            for arg in args:
                                if arg is dict or (
                                    inspect.isclass(arg) and issubclass(arg, BaseModel)
                                ):
                                    second_type_valid = True
                                    # Extract BaseModel if present
                                    if inspect.isclass(arg) and issubclass(arg, BaseModel):
                                        payload_schema_class = arg
                                    break
                except (TypeError, AttributeError):
                    pass

            if not second_type_valid:
                raise TypeError(
                    f"Workflow function '{func.__name__}': second parameter "
                    f"'{second_param.name}' must be typed as "
                    f"Union[BaseModel, dict[str, Any]] or a specific "
                    f"Pydantic BaseModel class, got {second_annotation}"
                )

        # Determine workflow ID
        workflow_id = id if id is not None else func.__name__

        # Parse queue configuration
        queue_name: str | None = None
        queue_concurrency_limit: int | None = None

        # Determine if workflow is schedulable
        is_schedulable = False
        if schedule is True:
            is_schedulable = True
        elif schedule is False:
            is_schedulable = False
        elif schedule is not None:
            # schedule is a cron string or dict - workflow is schedulable
            is_schedulable = True

        # Scheduled workflows cannot specify queues
        if is_schedulable and queue is not None:
            raise ValueError("Scheduled workflows cannot specify a queue.")

        if queue is not None:
            if isinstance(queue, str):
                # Queue name string
                queue_name = queue
            elif isinstance(queue, Queue):
                # Queue object
                queue_name = queue.name
                queue_concurrency_limit = queue.concurrency_limit
            elif isinstance(queue, dict):
                # Dict with concurrency_limit
                queue_name = queue.get(
                    "name", workflow_id
                )  # Use workflow_id as queue name if not provided
                queue_concurrency_limit = queue.get("concurrency_limit")
            else:
                raise ValueError(
                    f"Invalid queue type: {type(queue)}. Expected str, Queue, or dict."
                )

        workflow_obj = Workflow(
            id=workflow_id,
            func=func,
            description=description,
            queue_name=queue_name,
            queue_concurrency_limit=queue_concurrency_limit,
            trigger_on_event=trigger_on_event,
            batch_size=batch_size,
            batch_timeout_seconds=batch_timeout_seconds,
            schedule=schedule,
            on_start=on_start,
            on_end=on_end,
            payload_schema_class=payload_schema_class if len(params) >= 2 else None,
            state_schema=state_schema,
        )
        _WORKFLOW_REGISTRY[workflow_id] = workflow_obj
        return workflow_obj

    # Handle @workflow (without parentheses) - the function is passed as the first argument
    if callable(id):
        func = id
        id = None
        return decorator(func)

    # Handle @workflow() or @workflow(id="...", queue=...)
    return decorator


def get_workflow(workflow_id: str) -> Workflow | None:
    """Get a workflow by ID from the registry."""
    return _WORKFLOW_REGISTRY.get(workflow_id)


def get_all_workflows() -> dict[str, Workflow]:
    """Get all registered workflows."""
    return _WORKFLOW_REGISTRY.copy()
