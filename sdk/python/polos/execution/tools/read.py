"""Read tool -- read file contents from the execution environment.

When path_restriction is set, reads within the restriction proceed
without approval. Reads outside the restriction suspend for user approval.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, Field

from ...core.context import WorkflowContext
from ...tools.tool import Tool
from ..environment import ExecutionEnvironment
from .path_approval import PathRestrictionConfig, is_path_allowed, require_path_approval


class ReadInput(BaseModel):
    """Input schema for the read tool."""

    path: str = Field(description="Path to the file to read")
    offset: int | None = Field(
        default=None, description="Line offset to start reading from (0-based)"
    )
    limit: int | None = Field(default=None, description="Maximum number of lines to return")


def create_read_tool(
    get_env: Callable[[], Awaitable[ExecutionEnvironment]],
    path_config: PathRestrictionConfig | None = None,
) -> Tool:
    """Create the read tool for reading file contents.

    Args:
        get_env: Async callable that returns the shared ExecutionEnvironment.
        path_config: Optional path restriction configuration.

    Returns:
        A Tool instance for read.
    """

    async def handler(ctx: WorkflowContext, input: ReadInput) -> dict[str, Any]:
        env = await get_env()

        # Check path restriction -- approve if outside
        if path_config and path_config.path_restriction:
            resolved = os.path.abspath(os.path.join(env.get_cwd(), input.path))
            if not is_path_allowed(resolved, path_config.path_restriction):
                await require_path_approval(ctx, "read", resolved, path_config.path_restriction)

        content = await env.read_file(input.path)

        # Apply offset/limit if specified
        if input.offset is not None or input.limit is not None:
            lines = content.split("\n")
            start = input.offset or 0
            end = start + input.limit if input.limit is not None else len(lines)
            content = "\n".join(lines[start:end])

        return {"content": content, "path": input.path}

    async def wrapped_func(ctx: WorkflowContext, payload: dict[str, Any] | None):
        input_obj = ReadInput.model_validate(payload) if payload else ReadInput(path="")
        return await handler(ctx, input_obj)

    tool = Tool(
        id="read",
        description=(
            "Read the contents of a file. Returns the file content as text. "
            "Optionally specify offset (line number to start from, 0-based) and "
            "limit (number of lines)."
        ),
        parameters=ReadInput.model_json_schema(),
        func=wrapped_func,
    )
    tool._input_schema_class = ReadInput
    return tool
