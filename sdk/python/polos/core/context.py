"""Context classes for workflow and agent execution."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class WorkflowContext:
    """Context available to all workflow functions.

    Provides execution-related information that workflows can use for
    checkpointing, triggering sub-workflows, and other operations.

    Includes state managers for workflow-scoped, session-scoped, and user-scoped state.
    Also provides a Step helper for durable execution.
    """

    def __init__(
        self,
        workflow_id: str,
        execution_id: str,
        deployment_id: str,
        session_id: str,
        user_id: str | None = None,
        parent_execution_id: str | None = None,
        root_execution_id: str | None = None,
        root_workflow_id: str | None = None,
        retry_count: int = 0,
        created_at: datetime | None = None,
        workflow_type: str | None = "workflow",
        otel_traceparent: str | None = None,
        otel_span_id: str | None = None,
        state_schema: type[BaseModel] | None = None,
        initial_state: dict[str, Any] | None = None,
    ):
        self.workflow_id = workflow_id
        self.execution_id = execution_id
        self.deployment_id = deployment_id
        self.parent_execution_id = parent_execution_id
        self.root_execution_id = root_execution_id or execution_id
        self.root_workflow_id = root_workflow_id or workflow_id
        self.retry_count = retry_count
        self.created_at = created_at
        self.session_id = session_id
        self.user_id = user_id
        self.workflow_type = workflow_type
        self.otel_traceparent = otel_traceparent
        self.otel_span_id = otel_span_id

        # Initialize typed workflow state if state_schema is provided
        if state_schema:
            if initial_state:
                self.state = state_schema.model_validate(initial_state)
            else:
                self.state = state_schema()  # Use defaults
        else:
            self.state = None

        # Initialize step helper for durable execution
        from .step import Step

        self.step = Step(self)

    def to_dict(self) -> dict[str, Any]:
        """Convert context to dictionary for execution context cache."""
        return {
            "workflow_id": self.workflow_id,
            "execution_id": self.execution_id,
            "deployment_id": self.deployment_id,
            "parent_execution_id": self.parent_execution_id,
            "root_execution_id": self.root_execution_id,
            "retry_count": self.retry_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "session_id": self.session_id,
            "user_id": self.user_id,
        }


class AgentContext(WorkflowContext):
    """Context for agents - extends WorkflowContext with agent information."""

    def __init__(
        self,
        agent_id: str,
        execution_id: str,
        deployment_id: str,
        parent_execution_id: str | None = None,
        root_execution_id: str | None = None,
        root_workflow_id: str | None = None,
        retry_count: int = 0,
        model: str = "gpt-4",
        provider: str = "openai",
        system_prompt: str | None = None,
        tools: list[Any] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        session_id: str | None = None,
        conversation_id: str | None = None,
        user_id: str | None = None,
        created_at: datetime | None = None,
        otel_traceparent: str | None = None,
        otel_span_id: str | None = None,
        state_schema: type[BaseModel] | None = None,
        initial_state: dict[str, Any] | None = None,
    ):
        # Call parent with required parameters
        super().__init__(
            workflow_id=agent_id,
            execution_id=execution_id,
            deployment_id=deployment_id,
            session_id=session_id,
            user_id=user_id,
            parent_execution_id=parent_execution_id,
            root_execution_id=root_execution_id,
            root_workflow_id=root_workflow_id,
            retry_count=retry_count,
            created_at=created_at,
            workflow_type="agent",
            otel_traceparent=otel_traceparent,
            otel_span_id=otel_span_id,
            state_schema=state_schema,
            initial_state=initial_state,
        )
        self.agent_id = agent_id
        self.model = model
        self.provider = provider
        self.system_prompt = system_prompt
        self.tools = tools or []
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.conversation_id = conversation_id

    def to_dict(self) -> dict[str, Any]:
        """Convert context to dictionary, including agent-specific fields."""
        base_dict = super().to_dict()
        base_dict.update(
            {
                "model": self.model,
                "provider": self.provider,
                "system_prompt": self.system_prompt,
                "tools": self.tools,
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
            }
        )
        return base_dict
