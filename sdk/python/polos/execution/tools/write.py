"""Write tool -- create or overwrite files in the execution environment.

When path_restriction is set, writes within the restriction proceed
without approval. Writes outside the restriction suspend for user approval.
Set approval to 'always' to require approval for every write, or 'none'
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


class WriteInput(BaseModel):
    """Input schema for the write tool."""

    path: str = Field(description="Path to the file to write")
    content: str = Field(description="Content to write to the file")


class WriteToolConfig(BaseModel):
    """Configuration for the write tool."""

    approval: Literal["always", "none"] | None = None
    path_config: PathRestrictionConfig | None = None


def create_write_tool(
    get_env: Callable[[], Awaitable[ExecutionEnvironment]],
    config: WriteToolConfig | None = None,
) -> Tool:
    """Create the write tool for writing file contents.

    Args:
        get_env: Async callable that returns the shared ExecutionEnvironment.
        config: Optional configuration with approval mode and/or path restriction.

    Returns:
        A Tool instance for write.
    """

    async def handler(ctx: WorkflowContext, input: WriteInput) -> dict[str, Any]:
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
                    ctx, "write", resolved, config.path_config.path_restriction
                )

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
        approval="always" if config and config.approval == "always" else None,
    )
    tool._input_schema_class = WriteInput
    return tool
