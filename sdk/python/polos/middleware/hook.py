"""Hook decorator for lifecycle hooks.

Hooks are callables that can intercept and modify execution at various lifecycle points.
They are executed within a workflow execution context and support durable execution.

Hooks have a specific signature: (ctx: WorkflowContext, hook_context: HookContext) -> HookResult
"""

import inspect
from collections.abc import Callable
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict

from ..types.types import AgentConfig, Step


class HookAction(Enum):
    """Action a hook can take after execution."""

    CONTINUE = "continue"
    FAIL = "fail"


class HookContext(BaseModel):
    """Context available to hooks.

    This context is passed to hooks and contains information about
    the current execution state.
    """

    # Immutable identifiers
    workflow_id: str
    agent_workflow_id: str | None = None  # Available for agents
    agent_run_id: str | None = None  # Available for agents
    session_id: str | None = None
    user_id: str | None = None
    agent_config: AgentConfig | None = None

    # Current state
    steps: list[Step] = []  # All previous steps

    # For workflow/tool hooks
    current_tool: str | None = None
    current_payload: dict[str, Any] | None = None
    current_output: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert hook context to dictionary for serialization."""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: Any) -> "HookContext":
        """Create HookContext from dictionary."""
        if isinstance(data, HookContext):
            return data
        if isinstance(data, dict):
            return cls.model_validate(data)
        raise TypeError(f"Cannot create HookContext from {type(data)}")


class HookResult(BaseModel):
    """Result from a hook execution.

    Hooks return this to indicate what action to take and any modifications
    to apply to the execution state.
    """

    model_config = ConfigDict(use_enum_values=True)

    action: HookAction = HookAction.CONTINUE

    # Optional modifications
    modified_agent_config: AgentConfig | None = None
    modified_payload: dict[str, Any] | None = None
    modified_output: Any | None = None

    # For FAIL action
    error_message: str | None = None

    @classmethod
    def continue_with(cls, **modifications) -> "HookResult":
        """Continue with optional modifications.

        Args:
            **modifications: Can include modified_agent_config, modified_payload, modified_output

        Returns:
            HookResult with CONTINUE action and modifications
        """
        return cls(action=HookAction.CONTINUE, **modifications)

    @classmethod
    def fail(cls, message: str) -> "HookResult":
        """Fail processing with an error message.

        Args:
            message: Error message to return

        Returns:
            HookResult with FAIL action
        """
        return cls(action=HookAction.FAIL, error_message=message)

    def to_dict(self) -> dict[str, Any]:
        """Convert hook result to dictionary for serialization."""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "HookResult":
        """Create HookResult from dictionary."""
        return cls.model_validate(data)


def _validate_hook_signature(func: Callable) -> None:
    """Validate that hook function has correct signature.

    Expected: (ctx: WorkflowContext, hook_context: HookContext) -> HookResult

    Raises:
        TypeError: If signature is invalid
    """
    sig = inspect.signature(func)
    params = list(sig.parameters.values())

    # Must have exactly 2 parameters: ctx and hook_context
    if len(params) != 2:
        raise TypeError(
            f"Hook function '{func.__name__}' must have exactly 2 parameters: "
            f"(ctx: WorkflowContext, hook_context: HookContext). Got {len(params)} parameters."
        )


def hook(func: Callable | None = None):
    """
    Decorator to mark a function as a hook.

    Hook functions must have the signature:
        (ctx: WorkflowContext, hook_context: HookContext) -> HookResult

    Usage:
        @hook
        def my_hook(ctx: WorkflowContext, hook_context: HookContext) -> HookResult:
            return HookResult.continue_with()

    Args:
        func: The function to decorate (when used as @hook)

    Returns:
        The function itself (validated)

    Raises:
        TypeError: If function signature is invalid
    """

    def decorator(f: Callable) -> Callable:
        # Validate function signature
        _validate_hook_signature(f)
        return f

    # Handle @hook (without parentheses) - the function is passed as the first argument
    if func is not None:
        return decorator(func)

    # Handle @hook() - return decorator
    return decorator
