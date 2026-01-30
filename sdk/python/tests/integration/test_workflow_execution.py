"""Integration tests for workflow execution."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from polos import WorkflowContext, workflow
from polos.core.workflow import _execution_context
from polos.runtime.client import ExecutionHandle, PolosClient


class TestWorkflowExecution:
    """Integration tests for workflow execution."""

    @pytest.mark.asyncio
    async def test_simple_workflow_execution(self):
        """Test a simple workflow execution with mocked orchestrator."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        @workflow(id="test_workflow")
        async def test_workflow(ctx: WorkflowContext, payload: dict):
            """Simple test workflow."""
            return {"result": payload.get("value", 0) * 2}

        # Mock orchestrator API calls
        mock_handle = ExecutionHandle(
            id=execution_id,
            workflow_id="test_workflow",
            root_execution_id=root_execution_id,
        )

        mock_client = PolosClient(
            api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
        )
        with (
            patch("polos.core.step.get_client_or_raise", return_value=mock_client),
            patch("polos.runtime.client.get_client_or_raise", return_value=mock_client),
            patch("polos.features.wait.get_client_or_raise", return_value=mock_client),
            patch("polos.features.tracing.get_client_or_raise", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise", return_value=mock_client
            ),
            patch.object(
                mock_client, "_submit_workflow", new_callable=AsyncMock, return_value=mock_handle
            ),
            patch.object(ExecutionHandle, "get", new_callable=AsyncMock) as mock_get,
        ):
            # Mock execution completion
            mock_get.return_value = {
                "status": "completed",
                "result": {"result": 10},
            }

            # Set execution context
            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                # Execute workflow
                result = await test_workflow.func(
                    WorkflowContext(
                        workflow_id="test_workflow",
                        execution_id=execution_id,
                        root_execution_id=root_execution_id,
                        deployment_id="test-deployment",
                        session_id="test-session",
                    ),
                    {"value": 5},
                )

                assert result == {"result": 10}
            finally:
                _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_workflow_with_step_run(self):
        """Test workflow execution with step.run()."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        async def step_function(value: int) -> int:
            """A step function."""
            return value * 2

        @workflow(id="test_workflow_with_step")
        async def test_workflow(ctx: WorkflowContext, payload: dict):
            """Workflow with step.run()."""
            result = await ctx.step.run("multiply", step_function, payload.get("value", 0))
            return {"result": result}

        # Mock step output storage
        mock_client = PolosClient(
            api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
        )
        with (
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock) as mock_store,
            patch("polos.core.step.get_client_or_raise", return_value=mock_client),
            patch("polos.runtime.client.get_client_or_raise", return_value=mock_client),
            patch("polos.features.wait.get_client_or_raise", return_value=mock_client),
            patch("polos.features.tracing.get_client_or_raise", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise", return_value=mock_client
            ),
            patch.object(
                mock_client, "_get_headers", return_value={"Authorization": "Bearer test-key"}
            ),
            patch("polos.features.tracing.get_tracer") as mock_tracer,
            patch("polos.features.events.batch_publish", new_callable=AsyncMock, return_value=[]),
            patch("polos.core.step.batch_publish", new_callable=AsyncMock, return_value=[]),
        ):
            # Mock OpenTelemetry tracer
            mock_span = MagicMock()
            mock_span.__enter__ = MagicMock(return_value=mock_span)
            mock_span.__exit__ = MagicMock(return_value=False)
            mock_span_context = MagicMock()
            mock_span_context.trace_id = 0x1234567890ABCDEF1234567890ABCDEF
            mock_span_context.span_id = 0x1234567890ABCDEF
            mock_span.get_span_context = MagicMock(return_value=mock_span_context)
            mock_tracer_instance = MagicMock()
            mock_tracer_instance.start_as_current_span = MagicMock(return_value=mock_span)
            mock_tracer.return_value = mock_tracer_instance

            # Mock span context retrieval - need to handle None case
            def mock_get_span_context(exec_context):
                if (
                    exec_context
                    and "_otel_span_context" in exec_context
                    and exec_context["_otel_span_context"]
                ):
                    return exec_context["_otel_span_context"]
                return mock_span_context

            # Mock set_span_context to handle None span_context
            def safe_set_span_context(exec_context, span_context):
                if exec_context and span_context:
                    exec_context["_otel_span_context"] = span_context
                    exec_context["_otel_trace_id"] = format(span_context.trace_id, "032x")
                    exec_context["_otel_span_id"] = format(span_context.span_id, "016x")
                elif exec_context:
                    exec_context["_otel_span_context"] = None

            with (
                patch(
                    "polos.utils.tracing.get_span_context_from_execution_context",
                    side_effect=mock_get_span_context,
                ),
                patch(
                    "polos.utils.tracing.get_parent_span_context_from_execution_context",
                    return_value=mock_span_context,
                ),
                patch(
                    "polos.utils.tracing.set_span_context_in_execution_context",
                    side_effect=safe_set_span_context,
                ),
            ):
                _execution_context.set(
                    {
                        "execution_id": execution_id,
                        "root_execution_id": root_execution_id,
                    }
                )

                try:
                    ctx = WorkflowContext(
                        workflow_id="test_workflow_with_step",
                        execution_id=execution_id,
                        root_execution_id=root_execution_id,
                        deployment_id="test-deployment",
                        session_id="test-session",
                    )

                    result = await test_workflow.func(ctx, {"value": 5})

                    assert result == {"result": 10}
                    # Verify step output was stored
                    mock_store.assert_called_once()
                finally:
                    _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_workflow_with_state(self):
        """Test workflow execution with state management."""
        from polos import WorkflowState

        class CounterState(WorkflowState):
            count: int = 0

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        @workflow(id="test_workflow_state", state_schema=CounterState)
        async def test_workflow(ctx: WorkflowContext, payload: dict):
            """Workflow with state."""
            ctx.state.count += 1
            return {"count": ctx.state.count}

        with (
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
        ):
            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = WorkflowContext(
                    workflow_id="test_workflow_state",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    deployment_id="test-deployment",
                    session_id="test-session",
                    state_schema=CounterState,
                )

                result = await test_workflow.func(ctx, {})

                assert result == {"count": 1}
                assert ctx.state.count == 1
            finally:
                _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_workflow_with_hooks(self):
        """Test workflow execution with hooks."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        hook_called = False

        def on_start_hook(ctx: WorkflowContext, hook_ctx: dict):
            from polos.middleware.hook import HookResult

            nonlocal hook_called
            hook_called = True
            return HookResult.continue_with()

        @workflow(id="test_workflow_hooks", on_start=on_start_hook)
        async def test_workflow(ctx: WorkflowContext, payload: dict):
            """Workflow with hooks."""
            return {"result": "done"}

        mock_client = PolosClient(
            api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
        )
        with (
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
            patch(
                "polos.middleware.hook_executor.execute_hooks", new_callable=AsyncMock
            ) as mock_execute,
            patch("polos.core.step.get_client_or_raise", return_value=mock_client),
            patch("polos.runtime.client.get_client_or_raise", return_value=mock_client),
            patch("polos.features.wait.get_client_or_raise", return_value=mock_client),
            patch("polos.features.tracing.get_client_or_raise", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise", return_value=mock_client
            ),
            patch.object(
                mock_client, "_get_headers", return_value={"Authorization": "Bearer test-key"}
            ),
            patch("polos.features.events.batch_publish", new_callable=AsyncMock, return_value=[]),
            patch("polos.core.step.batch_publish", new_callable=AsyncMock, return_value=[]),
        ):
            from polos.middleware.hook import HookResult

            mock_execute.return_value = HookResult.continue_with()

            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                # Execute workflow through the _execute method which calls hooks
                context = {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                    "deployment_id": "test-deployment",
                    "session_id": "test-session",
                }
                result = await test_workflow._execute(context, {})

                # _execute returns a tuple (result, None) for hooks
                if isinstance(result, tuple):
                    result = result[0]

                assert result == {"result": "done"}
                # Hook executor should be called
                mock_execute.assert_called()
            finally:
                _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_workflow_error_handling(self):
        """Test workflow error handling."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        @workflow(id="test_workflow_error")
        async def test_workflow(ctx: WorkflowContext, payload: dict):
            """Workflow that raises an error."""
            raise ValueError("Test error")

        mock_client = PolosClient(
            api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
        )
        with (
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
            patch("polos.core.step.get_client_or_raise", return_value=mock_client),
            patch("polos.runtime.client.get_client_or_raise", return_value=mock_client),
            patch("polos.features.wait.get_client_or_raise", return_value=mock_client),
            patch("polos.features.tracing.get_client_or_raise", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise", return_value=mock_client
            ),
            patch.object(
                mock_client, "_get_headers", return_value={"Authorization": "Bearer test-key"}
            ),
        ):
            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = WorkflowContext(
                    workflow_id="test_workflow_error",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    deployment_id="test-deployment",
                    session_id="test-session",
                )

                with pytest.raises(ValueError, match="Test error"):
                    await test_workflow.func(ctx, {})
            finally:
                _execution_context.set(None)
