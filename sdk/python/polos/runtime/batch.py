"""Batch workflow triggering utilities."""

from typing import Any

from ..agents.agent import AgentRunConfig
from ..core.workflow import _execution_context
from ..types.types import BatchWorkflowInput
from .client import ExecutionHandle, PolosClient


async def batch_invoke(
    client: PolosClient,
    workflows: list[BatchWorkflowInput],
    session_id: str | None = None,
    user_id: str | None = None,
) -> list[ExecutionHandle]:
    """Invoke multiple different workflows in a single batch and return handles immediately.

    This function cannot be called from within a workflow or agent.
    Use step.batch_invoke() to call workflows from within workflows.

    Args:
        client: PolosClient instance
        workflows: List of BatchWorkflowInput objects with 'id' (workflow_id string)
            and 'payload' (dict or Pydantic model)
        session_id: Optional session ID
        user_id: Optional user ID

    Returns:
        List of ExecutionHandle objects for the submitted workflows

    Example:
        handles = await batch_invoke([
            BatchWorkflowInput(id="workflow-1", payload={"foo": "bar"}),
            BatchWorkflowInput(id="workflow-2", payload={"baz": 42}),
        ])
    """
    # Check if we're in an execution context - fail if we are
    if _execution_context.get() is not None:
        raise RuntimeError(
            "batch_invoke() cannot be called from within a workflow or agent. "
            "Use step.batch_invoke() to call workflows from within workflows."
        )

    return await client.batch_invoke(workflows, session_id=session_id, user_id=user_id)


async def batch_agent_invoke(
    client: PolosClient,
    agents: list[AgentRunConfig],
) -> list[ExecutionHandle]:
    """
    Invoke multiple agents in parallel and return execution handles.

    This helper is intended for use with Agent.with_input(), which returns
    AgentRunConfig instances.

    Args:
        client: PolosClient instance
        agents: List of AgentRunConfig instances

    Example:
        handles = await batch_agent_invoke([
            grammar_agent.with_input("Check this"),
            tone_agent.with_input("Check this too"),
        ])
    """
    workflows: list[BatchWorkflowInput] = []
    for config in agents:
        payload: dict[str, Any] = {
            "input": config.input,
            "streaming": config.streaming,
            "session_id": config.session_id,
            "user_id": config.user_id,
            **config.kwargs,
        }
        workflows.append(
            BatchWorkflowInput(
                id=config.agent.id,
                payload=payload,
                initial_state=config.initial_state,
                run_timeout_seconds=config.run_timeout_seconds,
            )
        )

    return await batch_invoke(client, workflows)
