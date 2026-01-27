"""Unit tests for polos.core.step module."""

import asyncio
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import BaseModel

from polos.core.step import Step
from polos.core.workflow import StepExecutionError


class TestStepInitialization:
    """Tests for Step class initialization."""

    def test_step_init(self, mock_workflow_context):
        """Test Step initialization."""
        step = Step(mock_workflow_context)
        assert step.ctx == mock_workflow_context


class TestCheckExistingStep:
    """Tests for _check_existing_step method."""

    @pytest.mark.asyncio
    async def test_check_existing_step_calls_get_step_output(self, mock_workflow_context):
        """Test that _check_existing_step calls get_step_output with correct parameters."""
        step = Step(mock_workflow_context)
        execution_id = mock_workflow_context.execution_id
        step_key = "test-step-key"

        with patch("polos.core.step.get_step_output", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"success": True, "outputs": {"result": "test"}}
            result = await step._check_existing_step(step_key)
            mock_get.assert_called_once_with(execution_id, step_key)
            assert result == {"success": True, "outputs": {"result": "test"}}

    @pytest.mark.asyncio
    async def test_check_existing_step_returns_none(self, mock_workflow_context):
        """Test that _check_existing_step returns None when no step exists."""
        step = Step(mock_workflow_context)
        step_key = "non-existent-step"

        with patch("polos.core.step.get_step_output", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = None
            result = await step._check_existing_step(step_key)
            assert result is None


class TestHandleExistingStep:
    """Tests for _handle_existing_step method."""

    @pytest.mark.asyncio
    async def test_handle_existing_step_success_with_outputs(self, mock_workflow_context):
        """Test _handle_existing_step with successful step that has outputs."""
        step = Step(mock_workflow_context)
        existing_step = {
            "success": True,
            "outputs": {"result": "test"},
            "output_schema_name": None,
        }

        with patch("polos.core.step.deserialize", new_callable=AsyncMock) as mock_deserialize:
            mock_deserialize.return_value = {"result": "test"}
            result = await step._handle_existing_step(existing_step)
            mock_deserialize.assert_called_once_with({"result": "test"}, None)
            assert result == {"result": "test"}

    @pytest.mark.asyncio
    async def test_handle_existing_step_success_without_outputs(self, mock_workflow_context):
        """Test _handle_existing_step with successful step but no outputs."""
        step = Step(mock_workflow_context)
        existing_step = {
            "success": True,
            "outputs": None,
            "output_schema_name": None,
        }

        result = await step._handle_existing_step(existing_step)
        assert result is None

    @pytest.mark.asyncio
    async def test_handle_existing_step_failure_raises_error(self, mock_workflow_context):
        """Test _handle_existing_step with failed step raises StepExecutionError."""
        step = Step(mock_workflow_context)
        existing_step = {
            "success": False,
            "error": {"message": "Step failed"},
        }

        with pytest.raises(StepExecutionError, match="Step failed"):
            await step._handle_existing_step(existing_step)

    @pytest.mark.asyncio
    async def test_handle_existing_step_failure_with_string_error(self, mock_workflow_context):
        """Test _handle_existing_step with failed step that has string error."""
        step = Step(mock_workflow_context)
        existing_step = {
            "success": False,
            "error": "Simple error message",
        }

        with pytest.raises(StepExecutionError, match="Simple error message"):
            await step._handle_existing_step(existing_step)

    @pytest.mark.asyncio
    async def test_handle_existing_step_failure_without_error_message(self, mock_workflow_context):
        """Test _handle_existing_step with failed step but no error message."""
        step = Step(mock_workflow_context)
        existing_step = {
            "success": False,
            "error": {},
        }

        with pytest.raises(StepExecutionError, match="Step execution failed"):
            await step._handle_existing_step(existing_step)


class TestSaveStepOutput:
    """Tests for _save_step_output method."""

    @pytest.mark.asyncio
    async def test_save_step_output_dict(self, mock_workflow_context):
        """Test _save_step_output with dict result."""
        step = Step(mock_workflow_context)
        step_key = "test-step"
        result = {"key": "value"}

        with patch("polos.core.step.store_step_output", new_callable=AsyncMock) as mock_store:
            await step._save_step_output(step_key, result)
            mock_store.assert_called_once_with(
                execution_id=mock_workflow_context.execution_id,
                step_key=step_key,
                outputs=result,
                error=None,
                success=True,
                source_execution_id=None,
                output_schema_name=None,
            )

    @pytest.mark.asyncio
    async def test_save_step_output_pydantic_model(self, mock_workflow_context):
        """Test _save_step_output with Pydantic model result."""

        class TestModel(BaseModel):
            name: str
            age: int

        step = Step(mock_workflow_context)
        step_key = "test-step"
        result = TestModel(name="test", age=25)

        with patch("polos.core.step.store_step_output", new_callable=AsyncMock) as mock_store:
            await step._save_step_output(step_key, result)
            mock_store.assert_called_once()
            call_kwargs = mock_store.call_args[1]
            assert call_kwargs["outputs"] == {"name": "test", "age": 25}
            assert (
                call_kwargs["output_schema_name"] == f"{TestModel.__module__}.{TestModel.__name__}"
            )
            assert call_kwargs["success"] is True
            assert call_kwargs["error"] is None

    @pytest.mark.asyncio
    async def test_save_step_output_with_source_execution_id(self, mock_workflow_context):
        """Test _save_step_output with source_execution_id."""
        step = Step(mock_workflow_context)
        step_key = "test-step"
        result = {"key": "value"}
        source_execution_id = str(uuid.uuid4())

        with patch("polos.core.step.store_step_output", new_callable=AsyncMock) as mock_store:
            await step._save_step_output(step_key, result, source_execution_id=source_execution_id)
            mock_store.assert_called_once()
            call_kwargs = mock_store.call_args[1]
            assert call_kwargs["source_execution_id"] == source_execution_id


class TestSaveStepOutputWithError:
    """Tests for _save_step_output_with_error method."""

    @pytest.mark.asyncio
    async def test_save_step_output_with_error(self, mock_workflow_context):
        """Test _save_step_output_with_error saves error correctly."""
        step = Step(mock_workflow_context)
        step_key = "test-step"
        error = "Test error message"

        with patch("polos.core.step.store_step_output", new_callable=AsyncMock) as mock_store:
            await step._save_step_output_with_error(step_key, error)
            mock_store.assert_called_once()
            call_kwargs = mock_store.call_args[1]
            assert call_kwargs["execution_id"] == mock_workflow_context.execution_id
            assert call_kwargs["step_key"] == step_key
            assert call_kwargs["outputs"] is None
            assert call_kwargs["error"] == {"message": error}  # Error is wrapped in dict
            assert call_kwargs["success"] is False
            assert call_kwargs["source_execution_id"] is None


class TestRaiseStepExecutionError:
    """Tests for _raise_step_execution_error method."""

    @pytest.mark.asyncio
    async def test_raise_step_execution_error(self, mock_workflow_context):
        """Test _raise_step_execution_error saves error and raises exception."""
        step = Step(mock_workflow_context)
        step_key = "test-step"
        error = "Test error message"

        with patch("polos.core.step.store_step_output", new_callable=AsyncMock) as mock_store:
            with pytest.raises(StepExecutionError, match="Test error message"):
                await step._raise_step_execution_error(step_key, error)
            mock_store.assert_called_once()
            call_kwargs = mock_store.call_args[1]
            assert call_kwargs["error"] == {"message": error}  # Error is wrapped in dict
            assert call_kwargs["success"] is False


class TestPublishStepEvent:
    """Tests for _publish_step_event method."""

    @pytest.mark.asyncio
    async def test_publish_step_event(self, mock_workflow_context):
        """Test _publish_step_event publishes event correctly."""
        step = Step(mock_workflow_context)
        event_type = "step_start"
        step_key = "test-step"
        event_name = "run"
        data = {"key": "value"}

        with patch("polos.core.step.batch_publish", new_callable=AsyncMock) as mock_publish:
            await step._publish_step_event(event_type, step_key, event_name, data)
            # Give the async task a moment to execute
            await asyncio.sleep(0.01)
            mock_publish.assert_called_once()
            # batch_publish is called with keyword arguments
            call_kwargs = mock_publish.call_args[1]
            events = call_kwargs["events"]
            assert len(events) == 1
            event = events[0]
            assert event.event_type == event_type
            assert event.data["step_key"] == step_key
            assert event.data["step_type"] == event_name  # Note: it's "step_type" not "event_name"
            assert "input_params" in event.data

    @pytest.mark.asyncio
    async def test_publish_step_event_topic(self, mock_workflow_context):
        """Test _publish_step_event uses correct topic."""
        step = Step(mock_workflow_context)
        root_execution_id = (
            mock_workflow_context.root_execution_id or mock_workflow_context.execution_id
        )

        with patch("polos.core.step.batch_publish", new_callable=AsyncMock) as mock_publish:
            await step._publish_step_event("step_start", "test-step", "run", {})
            call_kwargs = mock_publish.call_args[1]
            assert call_kwargs["topic"] == f"workflow:{root_execution_id}"
