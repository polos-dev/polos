"""Unit tests for polos.middleware.hook module."""

import pytest

from polos.core.context import WorkflowContext
from polos.middleware.hook import (
    HookAction,
    HookContext,
    HookResult,
    _validate_hook_signature,
    hook,
)


class TestHookAction:
    """Tests for HookAction enum."""

    def test_hook_action_values(self):
        """Test HookAction enum values."""
        assert HookAction.CONTINUE.value == "continue"
        assert HookAction.FAIL.value == "fail"


class TestHookContext:
    """Tests for HookContext class."""

    def test_hook_context_initialization(self):
        """Test HookContext initialization."""
        ctx = HookContext(workflow_id="test-workflow")
        assert ctx.workflow_id == "test-workflow"
        assert ctx.session_id is None
        assert ctx.user_id is None
        assert ctx.agent_config is None
        assert ctx.steps == []
        assert ctx.current_tool is None
        assert ctx.current_payload is None
        assert ctx.current_output is None

    def test_hook_context_full_initialization(self):
        """Test HookContext initialization with all fields."""
        from polos.types.types import AgentConfig, Step

        agent_config = AgentConfig(name="test-agent", provider="openai", model="gpt-4")
        steps = [Step(step=1, content="test")]
        ctx = HookContext(
            workflow_id="test-workflow",
            session_id="test-session",
            user_id="test-user",
            agent_config=agent_config,
            steps=steps,
            current_tool="test-tool",
            current_payload={"key": "value"},
            current_output={"result": "output"},
        )
        assert ctx.workflow_id == "test-workflow"
        assert ctx.session_id == "test-session"
        assert ctx.user_id == "test-user"
        assert ctx.agent_config == agent_config
        assert ctx.steps == steps
        assert ctx.current_tool == "test-tool"
        assert ctx.current_payload == {"key": "value"}
        assert ctx.current_output == {"result": "output"}

    def test_hook_context_to_dict(self):
        """Test HookContext.to_dict method."""
        ctx = HookContext(workflow_id="test-workflow", session_id="test-session")
        result = ctx.to_dict()
        assert isinstance(result, dict)
        assert result["workflow_id"] == "test-workflow"
        assert result["session_id"] == "test-session"

    def test_hook_context_from_dict(self):
        """Test HookContext.from_dict method."""
        data = {
            "workflow_id": "test-workflow",
            "session_id": "test-session",
            "user_id": "test-user",
        }
        ctx = HookContext.from_dict(data)
        assert ctx.workflow_id == "test-workflow"
        assert ctx.session_id == "test-session"
        assert ctx.user_id == "test-user"

    def test_hook_context_from_dict_with_instance(self):
        """Test HookContext.from_dict with HookContext instance."""
        original = HookContext(workflow_id="test-workflow")
        result = HookContext.from_dict(original)
        assert result == original

    def test_hook_context_from_dict_invalid_type(self):
        """Test HookContext.from_dict with invalid type raises TypeError."""
        with pytest.raises(TypeError, match="Cannot create HookContext"):
            HookContext.from_dict("not a dict or HookContext")


class TestHookResult:
    """Tests for HookResult class."""

    def test_hook_result_default(self):
        """Test HookResult with default values."""
        result = HookResult()
        assert result.action == HookAction.CONTINUE
        assert result.modified_payload is None
        assert result.modified_output is None
        assert result.error_message is None

    def test_hook_result_continue_with(self):
        """Test HookResult.continue_with factory method."""
        result = HookResult.continue_with(modified_payload={"new": "payload"})
        # Pydantic uses use_enum_values=True, so action is stored as string
        assert result.action == HookAction.CONTINUE.value
        assert result.modified_payload == {"new": "payload"}

    def test_hook_result_fail(self):
        """Test HookResult.fail factory method."""
        result = HookResult.fail("Error message")
        # Pydantic uses use_enum_values=True, so action is stored as string
        assert result.action == HookAction.FAIL.value
        assert result.error_message == "Error message"

    def test_hook_result_to_dict(self):
        """Test HookResult.to_dict method."""
        result = HookResult(action=HookAction.FAIL, error_message="Test error")
        data = result.to_dict()
        assert isinstance(data, dict)
        assert data["action"] == "fail"  # Enum value
        assert data["error_message"] == "Test error"

    def test_hook_result_from_dict(self):
        """Test HookResult.from_dict method."""
        data = {
            "action": "fail",
            "error_message": "Test error",
        }
        result = HookResult.from_dict(data)
        # Pydantic uses use_enum_values=True, so action is stored as string
        assert result.action == HookAction.FAIL.value
        assert result.error_message == "Test error"


class TestValidateHookSignature:
    """Tests for _validate_hook_signature function."""

    def test_valid_signature(self):
        """Test validation with valid signature."""

        def valid_hook(ctx: WorkflowContext, hook_context: HookContext) -> HookResult:
            return HookResult()

        # Should not raise
        _validate_hook_signature(valid_hook)

    def test_invalid_signature_too_few_params(self):
        """Test validation with too few parameters."""

        def invalid_hook(ctx: WorkflowContext) -> HookResult:
            return HookResult()

        with pytest.raises(TypeError, match="must have exactly 2 parameters"):
            _validate_hook_signature(invalid_hook)

    def test_invalid_signature_too_many_params(self):
        """Test validation with too many parameters."""

        def invalid_hook(ctx: WorkflowContext, hook_context: HookContext, extra: str) -> HookResult:
            return HookResult()

        with pytest.raises(TypeError, match="must have exactly 2 parameters"):
            _validate_hook_signature(invalid_hook)


class TestHookDecorator:
    """Tests for @hook decorator."""

    def test_hook_decorator_without_parentheses(self):
        """Test @hook decorator without parentheses."""

        @hook
        def my_hook(ctx: WorkflowContext, hook_context: HookContext) -> HookResult:
            return HookResult()

        # Should not raise and function should be callable
        assert callable(my_hook)

    def test_hook_decorator_with_parentheses(self):
        """Test @hook() decorator with parentheses."""

        @hook()
        def my_hook(ctx: WorkflowContext, hook_context: HookContext) -> HookResult:
            return HookResult()

        # Should not raise and function should be callable
        assert callable(my_hook)

    def test_hook_decorator_invalid_signature(self):
        """Test @hook decorator with invalid signature raises TypeError."""
        with pytest.raises(TypeError, match="must have exactly 2 parameters"):

            @hook
            def invalid_hook(ctx: WorkflowContext) -> HookResult:
                return HookResult()
