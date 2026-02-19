"""Edit tool -- find-and-replace text in files in the execution environment.

When path_restriction is set, edits within the restriction proceed
without approval. Edits outside the restriction suspend for user approval.
Set approval to 'always' to require approval for every edit, or 'none'
to skip approval entirely (overrides path restriction).
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel, Field

from ...core.context import WorkflowContext
from ...tools.tool import Tool
from ..environment import ExecutionEnvironment
from .path_approval import PathRestrictionConfig, is_path_allowed, require_path_approval


class EditInput(BaseModel):
    """Input schema for the edit tool."""

    path: str = Field(description="Path to the file to edit")
    old_text: str = Field(description="Exact text to find and replace")
    new_text: str = Field(description="Text to replace the old_text with")


class EditToolConfig(BaseModel):
    """Configuration for the edit tool."""

    approval: Literal["always", "none"] | None = None
    path_config: PathRestrictionConfig | None = None


def create_edit_tool(
    get_env: Callable[[], Awaitable[ExecutionEnvironment]],
    config: EditToolConfig | None = None,
) -> Tool:
    """Create the edit tool for find-and-replace in files.

    Args:
        get_env: Async callable that returns the shared ExecutionEnvironment.
        config: Optional configuration with approval mode and/or path restriction.

    Returns:
        A Tool instance for edit.
    """

    async def handler(ctx: WorkflowContext, input: EditInput) -> dict[str, Any]:
        env = await get_env()

        # Path-restricted approval: approve if outside cwd, skip if inside
        if (
            not (config and config.approval)
            and config
            and config.path_config
            and config.path_config.path_restriction
        ):
            resolved = os.path.abspath(os.path.join(env.get_cwd(), input.path))
            if not is_path_allowed(resolved, config.path_config.path_restriction):
                await require_path_approval(
                    ctx, "edit", resolved, config.path_config.path_restriction
                )

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
        approval="always" if config and config.approval == "always" else None,
    )
    tool._input_schema_class = EditInput
    return tool
