"""Write tool -- create or overwrite files in the execution environment."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel, Field

from ...core.context import WorkflowContext
from ...tools.tool import Tool
from ..environment import ExecutionEnvironment


class WriteInput(BaseModel):
    """Input schema for the write tool."""

    path: str = Field(description="Path to the file to write")
    content: str = Field(description="Content to write to the file")


def create_write_tool(
    get_env: Callable[[], Awaitable[ExecutionEnvironment]],
    approval: Literal["always", "none"] | None = None,
) -> Tool:
    """Create the write tool for writing file contents.

    Args:
        get_env: Async callable that returns the shared ExecutionEnvironment.
        approval: Optional approval mode ('always' requires user approval before write).

    Returns:
        A Tool instance for write.
    """

    async def handler(ctx: WorkflowContext, input: WriteInput) -> dict[str, Any]:
        env = await get_env()
        await env.write_file(input.path, input.content)
        return {"success": True, "path": input.path}

    async def wrapped_func(ctx: WorkflowContext, payload: dict[str, Any] | None):
        input_obj = (
            WriteInput.model_validate(payload) if payload else WriteInput(path="", content="")
        )
        return await handler(ctx, input_obj)

    tool = Tool(
        id="write",
        description=(
            "Write content to a file. Creates the file if it does not exist, or "
            "overwrites it if it does. Parent directories are created automatically."
        ),
        parameters=WriteInput.model_json_schema(),
        func=wrapped_func,
        approval=approval,
    )
    tool._input_schema_class = WriteInput
    return tool
