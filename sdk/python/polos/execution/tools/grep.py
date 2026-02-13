"""Grep tool -- search file contents by pattern in the execution environment.

When path_restriction is set, searches within the restriction proceed
without approval. Custom cwd outside the restriction suspends for approval.
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


class GrepInput(BaseModel):
    """Input schema for the grep tool."""

    pattern: str = Field(description="Search pattern (regex supported)")
    cwd: str | None = Field(default=None, description="Directory to search in")
    include: list[str] | None = Field(
        default=None,
        description='File patterns to include (e.g., ["*.ts", "*.js"])',
    )
    max_results: int | None = Field(
        default=None,
        description="Maximum number of matches to return (default: 100)",
    )
    context_lines: int | None = Field(
        default=None, description="Number of context lines around each match"
    )


def create_grep_tool(
    get_env: Callable[[], Awaitable[ExecutionEnvironment]],
    path_config: PathRestrictionConfig | None = None,
) -> Tool:
    """Create the grep tool for searching file contents.

    Args:
        get_env: Async callable that returns the shared ExecutionEnvironment.
        path_config: Optional path restriction configuration.

    Returns:
        A Tool instance for grep.
    """

    async def handler(ctx: WorkflowContext, input: GrepInput) -> dict[str, Any]:
        env = await get_env()

        # Check path restriction on custom cwd
        if path_config and path_config.path_restriction and input.cwd:
            resolved = os.path.abspath(os.path.join(env.get_cwd(), input.cwd))
            if not is_path_allowed(resolved, path_config.path_restriction):
                await require_path_approval(ctx, "grep", resolved, path_config.path_restriction)

        from ..types import GrepOptions

        matches = await env.grep(
            input.pattern,
            GrepOptions(
                cwd=input.cwd,
                include=input.include,
                max_results=input.max_results,
                context_lines=input.context_lines,
            ),
        )
        return {"matches": [m.model_dump() for m in matches]}

    async def wrapped_func(ctx: WorkflowContext, payload: dict[str, Any] | None):
        input_obj = GrepInput.model_validate(payload) if payload else GrepInput(pattern="")
        return await handler(ctx, input_obj)

    tool = Tool(
        id="grep",
        description=(
            "Search file contents for a pattern using grep. Returns matching lines with "
            "file paths and line numbers. Use this to find code patterns, references, "
            "or specific text."
        ),
        parameters=GrepInput.model_json_schema(),
        func=wrapped_func,
    )
    tool._input_schema_class = GrepInput
    return tool
