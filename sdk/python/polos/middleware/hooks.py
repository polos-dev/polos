"""Lifecycle hooks for workflows, and agents.

Hooks allow you to intercept and modify execution at various lifecycle points.
Hooks execute durably within workflow context.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict

from .types import AgentConfig, Step


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
