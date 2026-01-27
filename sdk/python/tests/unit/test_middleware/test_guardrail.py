"""Unit tests for polos.middleware.guardrail module."""

import pytest

from polos.core.context import WorkflowContext
from polos.middleware.guardrail import (
    GuardrailContext,
    GuardrailResult,
    _validate_guardrail_signature,
    guardrail,
)
from polos.middleware.hook import HookAction
from polos.types.types import AgentConfig, ToolCall


class TestGuardrailContext:
    """Tests for GuardrailContext class."""

    def test_guardrail_context_initialization(self):
        """Test GuardrailContext initialization."""
        ctx = GuardrailContext(agent_workflow_id="test-agent", agent_run_id="test-run")
        assert ctx.content is None
        assert ctx.tool_calls is None
        assert ctx.agent_workflow_id == "test-agent"
        assert ctx.agent_run_id == "test-run"
        assert ctx.session_id is None
        assert ctx.user_id is None
        assert ctx.steps == []

    def test_guardrail_context_full_initialization(self):
        """Test GuardrailContext initialization with all fields."""
        from polos.types.types import Step

        agent_config = AgentConfig(name="test-agent", provider="openai", model="gpt-4")
        tool_call = ToolCall(id="call-1", function={"name": "test_tool", "arguments": "{}"})
        steps = [Step(step=1, content="test")]
        ctx = GuardrailContext(
            content="LLM response",
            tool_calls=[tool_call],
            agent_workflow_id="test-agent",
            agent_run_id="test-run",
            session_id="test-session",
            user_id="test-user",
            llm_config=agent_config,
            steps=steps,
        )
        assert ctx.content == "LLM response"
        assert ctx.tool_calls == [tool_call]
        assert ctx.agent_workflow_id == "test-agent"
        assert ctx.agent_run_id == "test-run"
        assert ctx.session_id == "test-session"
        assert ctx.user_id == "test-user"
        assert ctx.llm_config == agent_config
        assert ctx.steps == steps

    def test_guardrail_context_to_dict(self):
        """Test GuardrailContext.to_dict method."""
        ctx = GuardrailContext(
            agent_workflow_id="test-agent", agent_run_id="test-run", content="test"
        )
        result = ctx.to_dict()
        assert isinstance(result, dict)
        assert result["agent_workflow_id"] == "test-agent"
        assert result["content"] == "test"

    def test_guardrail_context_from_dict(self):
        """Test GuardrailContext.from_dict method."""
        data = {
            "agent_workflow_id": "test-agent",
            "agent_run_id": "test-run",
            "content": "test",
        }
        ctx = GuardrailContext.from_dict(data)
        assert ctx.agent_workflow_id == "test-agent"
        assert ctx.content == "test"

    def test_guardrail_context_from_dict_with_instance(self):
        """Test GuardrailContext.from_dict with GuardrailContext instance."""
        original = GuardrailContext(agent_workflow_id="test-agent", agent_run_id="test-run")
        result = GuardrailContext.from_dict(original)
        assert result == original

    def test_guardrail_context_from_dict_invalid_type(self):
        """Test GuardrailContext.from_dict with invalid type raises TypeError."""
        with pytest.raises(TypeError, match="Cannot create GuardrailContext"):
            GuardrailContext.from_dict("not a dict or GuardrailContext")


class TestGuardrailResult:
    """Tests for GuardrailResult class."""

    def test_guardrail_result_default(self):
        """Test GuardrailResult with default values."""
        result = GuardrailResult()
        assert result.action == HookAction.CONTINUE
        assert result.modified_content is None
        assert result.modified_tool_calls is None
        assert result.modified_llm_config is None

    def test_guardrail_result_continue_with(self):
        """Test GuardrailResult.continue_with factory method."""
        tool_call = ToolCall(id="call-1", function={"name": "test_tool", "arguments": "{}"})
        result = GuardrailResult.continue_with(
            modified_content="Modified content",
            modified_tool_calls=[tool_call],
        )
        # Pydantic uses use_enum_values=True, so action is stored as string
        assert result.action == HookAction.CONTINUE.value
        assert result.modified_content == "Modified content"
        assert result.modified_tool_calls == [tool_call]

    def test_guardrail_result_fail(self):
        """Test GuardrailResult.fail factory method."""
        result = GuardrailResult.fail("Error message")
        # Pydantic uses use_enum_values=True, so action is stored as string
        assert result.action == HookAction.FAIL.value
        assert result.error_message == "Error message"

    def test_guardrail_result_to_dict(self):
        """Test GuardrailResult.to_dict method."""
        result = GuardrailResult(action=HookAction.FAIL, error_message="Test error")
        data = result.to_dict()
        assert isinstance(data, dict)
        assert data["action"] == "fail"
        assert data["error_message"] == "Test error"

    def test_guardrail_result_from_dict(self):
        """Test GuardrailResult.from_dict method."""
        data = {
            "action": "fail",
            "error_message": "Test error",
        }
        result = GuardrailResult.from_dict(data)
        # Pydantic uses use_enum_values=True, so action is stored as string
        assert result.action == HookAction.FAIL.value
        assert result.error_message == "Test error"

    def test_guardrail_result_inherits_from_hook_result(self):
        """Test that GuardrailResult inherits from HookResult."""
        result = GuardrailResult()
        # Should have HookResult methods
        assert hasattr(result, "continue_with")
        assert hasattr(result, "fail")
        assert hasattr(result, "to_dict")
        assert hasattr(result, "from_dict")


class TestValidateGuardrailSignature:
    """Tests for _validate_guardrail_signature function."""

    def test_valid_signature(self):
        """Test validation with valid signature."""

        def valid_guardrail(
            ctx: WorkflowContext, guardrail_context: GuardrailContext
        ) -> GuardrailResult:
            return GuardrailResult()

        # Should not raise
        _validate_guardrail_signature(valid_guardrail)

    def test_invalid_signature_too_few_params(self):
        """Test validation with too few parameters."""

        def invalid_guardrail(ctx: WorkflowContext) -> GuardrailResult:
            return GuardrailResult()

        with pytest.raises(TypeError, match="must have exactly 2 parameters"):
            _validate_guardrail_signature(invalid_guardrail)

    def test_invalid_signature_too_many_params(self):
        """Test validation with too many parameters."""

        def invalid_guardrail(
            ctx: WorkflowContext,
            guardrail_context: GuardrailContext,
            extra: str,
        ) -> GuardrailResult:
            return GuardrailResult()

        with pytest.raises(TypeError, match="must have exactly 2 parameters"):
            _validate_guardrail_signature(invalid_guardrail)


class TestGuardrailDecorator:
    """Tests for @guardrail decorator."""

    def test_guardrail_decorator_without_parentheses(self):
        """Test @guardrail decorator without parentheses."""

        @guardrail
        def my_guardrail(
            ctx: WorkflowContext, guardrail_context: GuardrailContext
        ) -> GuardrailResult:
            return GuardrailResult()

        # Should not raise and function should be callable
        assert callable(my_guardrail)

    def test_guardrail_decorator_with_parentheses(self):
        """Test @guardrail() decorator with parentheses."""

        @guardrail()
        def my_guardrail(
            ctx: WorkflowContext, guardrail_context: GuardrailContext
        ) -> GuardrailResult:
            return GuardrailResult()

        # Should not raise and function should be callable
        assert callable(my_guardrail)

    def test_guardrail_decorator_invalid_signature(self):
        """Test @guardrail decorator with invalid signature raises TypeError."""
        with pytest.raises(TypeError, match="must have exactly 2 parameters"):

            @guardrail
            def invalid_guardrail(ctx: WorkflowContext) -> GuardrailResult:
                return GuardrailResult()
