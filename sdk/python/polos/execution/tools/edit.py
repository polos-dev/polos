"""Edit tool -- find-and-replace text in files in the execution environment."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel, Field

from ...core.context import WorkflowContext
from ...tools.tool import Tool
from ..environment import ExecutionEnvironment


class EditInput(BaseModel):
    """Input schema for the edit tool."""

    path: str = Field(description="Path to the file to edit")
    old_text: str = Field(description="Exact text to find and replace")
    new_text: str = Field(description="Text to replace the old_text with")


def create_edit_tool(
    get_env: Callable[[], Awaitable[ExecutionEnvironment]],
    approval: Literal["always", "none"] | None = None,
) -> Tool:
    """Create the edit tool for find-and-replace in files.

    Args:
        get_env: Async callable that returns the shared ExecutionEnvironment.
        approval: Optional approval mode ('always' requires user approval before edit).

    Returns:
        A Tool instance for edit.
    """

    async def handler(ctx: WorkflowContext, input: EditInput) -> dict[str, Any]:
        env = await get_env()
        content = await env.read_file(input.path)

        if input.old_text not in content:
            raise ValueError(
                f"old_text not found in {input.path}. Make sure the text matches exactly, "
                "including whitespace and indentation."
            )

        new_content = content.replace(input.old_text, input.new_text, 1)
        await env.write_file(input.path, new_content)

        return {"success": True, "path": input.path}

    async def wrapped_func(ctx: WorkflowContext, payload: dict[str, Any] | None):
        input_obj = (
            EditInput.model_validate(payload)
            if payload
            else EditInput(path="", old_text="", new_text="")
        )
        return await handler(ctx, input_obj)

    tool = Tool(
        id="edit",
        description=(
            "Edit a file by replacing an exact string match. The old_text must match exactly "
            "(including whitespace and indentation). Use this for precise code modifications."
        ),
        parameters=EditInput.model_json_schema(),
        func=wrapped_func,
        approval=approval,
    )
    tool._input_schema_class = EditInput
    return tool
