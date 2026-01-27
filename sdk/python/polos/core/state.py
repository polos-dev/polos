"""State management for sessions and users."""

from pydantic import BaseModel, ConfigDict


class WorkflowState(BaseModel):
    """Base class for workflow state.

    Workflow state is a Pydantic model that persists across workflow execution.
    State is saved only when the workflow completes or fails.

    Example:
        from polos import WorkflowState, workflow, WorkflowContext

        class MyState(WorkflowState):
            counter: int = 0
            items: list[str] = []

        @workflow(state_schema=MyState)
        async def my_workflow(ctx: WorkflowContext, payload: dict):
            ctx.state.counter += 1
            ctx.state.items.append("new")
            return {"done": True}
    """

    model_config = ConfigDict(validate_assignment=True)
