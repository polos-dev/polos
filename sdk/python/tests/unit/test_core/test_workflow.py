"""Unit tests for polos.core.workflow module."""

import pytest
from pydantic import BaseModel

from polos.core.workflow import StepExecutionError, Workflow, WorkflowTimeoutError


class TestWorkflowInitialization:
    """Tests for Workflow class initialization."""

    def test_workflow_init_basic(self):
        """Test basic Workflow initialization."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func)
        assert workflow.id == "test-workflow"
        assert workflow.func == test_func
        assert workflow.is_async is True
        assert workflow.has_payload_param is True
        assert workflow.workflow_type == "workflow"
        assert workflow.state_schema is None
        assert workflow.queue_name is None
        assert workflow.is_schedulable is False

    def test_workflow_init_sync_function(self):
        """Test Workflow initialization with sync function."""

        def sync_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=sync_func)
        assert workflow.is_async is False
        assert workflow.has_payload_param is True

    def test_workflow_init_no_payload(self):
        """Test Workflow initialization with function that has no payload parameter."""

        async def no_payload_func(ctx):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=no_payload_func)
        assert workflow.has_payload_param is False

    def test_workflow_init_with_state_schema(self):
        """Test Workflow initialization with state_schema."""

        class TestState(BaseModel):
            counter: int = 0

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func, state_schema=TestState)
        assert workflow.state_schema == TestState

    def test_workflow_init_with_queue(self):
        """Test Workflow initialization with queue configuration."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(
            id="test-workflow",
            func=test_func,
            queue_name="test-queue",
            queue_concurrency_limit=5,
        )
        assert workflow.queue_name == "test-queue"
        assert workflow.queue_concurrency_limit == 5

    def test_workflow_init_schedulable_true(self):
        """Test Workflow initialization with schedule=True."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func, schedule=True)
        assert workflow.is_schedulable is True

    def test_workflow_init_schedulable_cron(self):
        """Test Workflow initialization with cron schedule."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func, schedule="0 0 * * *")
        assert workflow.is_schedulable is True

    def test_workflow_init_event_triggered(self):
        """Test Workflow initialization with event trigger."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func, trigger_on_event="test-event")
        assert workflow.trigger_on_event == "test-event"

    def test_workflow_init_scheduled_and_event_triggered_raises(self):
        """Test that workflows cannot be both scheduled and event-triggered."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        with pytest.raises(ValueError, match="cannot be both scheduled and event-triggered"):
            Workflow(
                id="test-workflow",
                func=test_func,
                schedule=True,
                trigger_on_event="test-event",
            )

    def test_workflow_init_scheduled_with_queue_raises(self):
        """Test that scheduled workflows cannot specify queue."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        with pytest.raises(ValueError, match="Scheduled workflows cannot specify"):
            Workflow(
                id="test-workflow",
                func=test_func,
                schedule=True,
                queue_name="test-queue",
            )


class TestPreparePayload:
    """Tests for _prepare_payload method."""

    def test_prepare_payload_none(self):
        """Test _prepare_payload with None."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func)
        result = workflow._prepare_payload(None)
        assert result is None

    def test_prepare_payload_dict(self):
        """Test _prepare_payload with dict."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func)
        payload = {"key": "value"}
        result = workflow._prepare_payload(payload)
        assert result == payload

    def test_prepare_payload_pydantic_model(self):
        """Test _prepare_payload with Pydantic model."""

        class PayloadModel(BaseModel):
            name: str
            age: int

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func)
        payload = PayloadModel(name="test", age=25)
        result = workflow._prepare_payload(payload)
        assert isinstance(result, dict)
        assert result == {"name": "test", "age": 25}

    def test_prepare_payload_invalid_type(self):
        """Test _prepare_payload with invalid type raises TypeError."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func)
        with pytest.raises(TypeError, match="must be a dict or Pydantic BaseModel"):
            workflow._prepare_payload("not a dict or model")


class TestNormalizeHooks:
    """Tests for _normalize_hooks method."""

    def test_normalize_hooks_none(self):
        """Test _normalize_hooks with None."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func)
        result = workflow._normalize_hooks(None)
        assert result == []

    def test_normalize_hooks_single_callable(self):
        """Test _normalize_hooks with single callable."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        def hook_func(ctx, hook_ctx):
            pass

        workflow = Workflow(id="test-workflow", func=test_func)
        result = workflow._normalize_hooks(hook_func)
        assert len(result) == 1
        assert result[0] == hook_func

    def test_normalize_hooks_list(self):
        """Test _normalize_hooks with list of callables."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        def hook1(ctx, hook_ctx):
            pass

        def hook2(ctx, hook_ctx):
            pass

        workflow = Workflow(id="test-workflow", func=test_func)
        result = workflow._normalize_hooks([hook1, hook2])
        assert len(result) == 2
        assert result[0] == hook1
        assert result[1] == hook2

    def test_normalize_hooks_list_with_invalid_raises(self):
        """Test _normalize_hooks with list containing non-callable raises TypeError."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        def hook_func(ctx, hook_ctx):
            pass

        workflow = Workflow(id="test-workflow", func=test_func)
        with pytest.raises(TypeError, match="Invalid hook type"):
            workflow._normalize_hooks([hook_func, "not a callable"])

    def test_normalize_hooks_invalid_type_raises(self):
        """Test _normalize_hooks with invalid type raises TypeError."""

        async def test_func(ctx, payload):
            return {"result": "test"}

        workflow = Workflow(id="test-workflow", func=test_func)
        with pytest.raises(TypeError, match="Invalid hooks type"):
            workflow._normalize_hooks("not a callable or list")


class TestStepExecutionError:
    """Tests for StepExecutionError exception."""

    def test_step_execution_error_with_reason(self):
        """Test StepExecutionError with reason."""
        error = StepExecutionError("Test error message")
        assert error.reason == "Test error message"
        assert str(error) == "Test error message"

    def test_step_execution_error_without_reason(self):
        """Test StepExecutionError without reason."""
        error = StepExecutionError()
        assert error.reason is None


class TestWorkflowTimeoutError:
    """Tests for WorkflowTimeoutError exception."""

    def test_workflow_timeout_error_with_execution_id(self):
        """Test WorkflowTimeoutError with execution_id."""
        error = WorkflowTimeoutError(execution_id="test-execution-123", timeout_seconds=30.0)
        assert error.execution_id == "test-execution-123"
        assert error.timeout_seconds == 30.0
        assert "test-execution-123" in str(error)
        assert "30.0" in str(error)

    def test_workflow_timeout_error_without_execution_id(self):
        """Test WorkflowTimeoutError without execution_id."""
        error = WorkflowTimeoutError(timeout_seconds=30.0)
        assert error.execution_id is None
        assert error.timeout_seconds == 30.0
        assert "30.0" in str(error)
