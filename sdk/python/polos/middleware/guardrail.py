"""Guardrail classes for validating/modifying LLM responses before tool execution.

Guardrails are executed after LLM calls but before tool execution.
They can validate, filter, or modify the LLM content and tool_calls.
"""

import inspect
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from ..types.types import AgentConfig, Step, ToolCall
from .hook import HookAction, HookResult


class GuardrailContext(BaseModel):
    """Context specific to guardrails - what they receive.

    Guardrails receive the LLM response (content and tool_calls) along with
    execution context to make validation/modification decisions.
    """

    # LLM response data
    content: Any | None = None  # LLM response content
    tool_calls: list[ToolCall] | None = None  # LLM tool calls

    # Execution context (for guardrail to make decisions)
    agent_workflow_id: str | None = ""
    agent_run_id: str | None = ""
    session_id: str | None = None
    user_id: str | None = None
    llm_config: AgentConfig = AgentConfig(name="", provider="", model="")
    steps: list[Step] = []  # Previous conversation steps

    def to_dict(self) -> dict[str, Any]:
        """Convert to dict for serialization."""
        return self.model_dump(mode="json")

    @classmethod
    def from_dict(cls, data: Any) -> "GuardrailContext":
        """Create GuardrailContext from dictionary."""
        if isinstance(data, GuardrailContext):
            return data
        if isinstance(data, dict):
            return cls.model_validate(data)
        raise TypeError(f"Cannot create GuardrailContext from {type(data)}")


class GuardrailResult(HookResult):
    """Result from guardrail execution.

    Inherits from HookResult but adds guardrail-specific modifications
    for LLM content and tool_calls.
    """

    # Modify LLM response
    modified_content: Any | None = None  # Modified content
    modified_tool_calls: list[ToolCall] | None = None  # Modified tool calls
    modified_llm_config: AgentConfig | None = None

    # If modified_tool_calls is empty list [], no tools will be executed
    # If modified_tool_calls is None, original tool_calls are used

    def to_dict(self) -> dict[str, Any]:
        """Convert to dict, including guardrail-specific fields."""
        return self.model_dump(mode="json")

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GuardrailResult":
        """Create GuardrailResult from dictionary."""
        return cls.model_validate(data)

    @classmethod
    def continue_with(cls, **modifications) -> "GuardrailResult":
        """Continue with optional modifications.

        Args:
            **modifications: Can include modified_content, modified_tool_calls,
                           modified_agent_config, etc.
        """
        return cls(action=HookAction.CONTINUE, **modifications)

    @classmethod
    def fail(cls, message: str) -> "GuardrailResult":
        """Fail processing with an error message.

        Args:
            message: Error message to return
        """
        return cls(action=HookAction.FAIL, error_message=message)


def _validate_guardrail_signature(func: Callable) -> None:
    """Validate that guardrail function has correct signature.

    Expected: (ctx: WorkflowContext, guardrail_context: GuardrailContext) -> GuardrailResult

    Raises:
        TypeError: If signature is invalid
    """
    sig = inspect.signature(func)
    params = list(sig.parameters.values())

    # Must have exactly 2 parameters: ctx and guardrail_context
    if len(params) != 2:
        raise TypeError(
            f"Guardrail function '{func.__name__}' must have exactly 2 parameters: "
            f"(ctx: WorkflowContext, guardrail_context: GuardrailContext). "
            f"Got {len(params)} parameters."
        )


def guardrail(func: Callable | None = None):
    """
    Decorator to mark a function as a guardrail.

    Guardrail functions must have the signature:
        (ctx: WorkflowContext, guardrail_context: GuardrailContext) -> GuardrailResult

    Usage:
        @guardrail
        def my_guardrail(
            ctx: WorkflowContext, guardrail_context: GuardrailContext
        ) -> GuardrailResult:
            return GuardrailResult.continue_with()

    Args:
        func: The function to decorate (when used as @guardrail)

    Returns:
        The function itself (validated)

    Raises:
        TypeError: If function signature is invalid
    """

    def decorator(f: Callable) -> Callable:
        # Validate function signature
        _validate_guardrail_signature(f)
        return f

    # Handle @guardrail (without parentheses) - the function is passed as the first argument
    if func is not None:
        return decorator(func)

    # Handle @guardrail() - return decorator
    return decorator
