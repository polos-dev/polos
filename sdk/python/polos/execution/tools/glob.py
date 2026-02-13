"""Glob tool -- find files by pattern in the execution environment.

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


class GlobInput(BaseModel):
    """Input schema for the glob tool."""

    pattern: str = Field(description='Glob pattern to match (e.g., "*.ts", "src/**/*.js")')
    cwd: str | None = Field(default=None, description="Directory to search in")
    ignore: list[str] | None = Field(default=None, description="Patterns to exclude from results")


def create_glob_tool(
    get_env: Callable[[], Awaitable[ExecutionEnvironment]],
    path_config: PathRestrictionConfig | None = None,
) -> Tool:
    """Create the glob tool for finding files by pattern.

    Args:
        get_env: Async callable that returns the shared ExecutionEnvironment.
        path_config: Optional path restriction configuration.

    Returns:
        A Tool instance for glob.
    """

    async def handler(ctx: WorkflowContext, input: GlobInput) -> dict[str, Any]:
        env = await get_env()

        # Check path restriction on custom cwd
        if path_config and path_config.path_restriction and input.cwd:
            resolved = os.path.abspath(os.path.join(env.get_cwd(), input.cwd))
            if not is_path_allowed(resolved, path_config.path_restriction):
                await require_path_approval(ctx, "glob", resolved, path_config.path_restriction)

        from ..types import GlobOptions

        files = await env.glob(
            input.pattern,
            GlobOptions(cwd=input.cwd, ignore=input.ignore),
        )
        return {"files": files}

    async def wrapped_func(ctx: WorkflowContext, payload: dict[str, Any] | None):
        input_obj = GlobInput.model_validate(payload) if payload else GlobInput(pattern="")
        return await handler(ctx, input_obj)

    tool = Tool(
        id="glob",
        description=(
            "Find files matching a glob pattern. Returns a list of file paths. "
            "Use this to discover files in the project structure."
        ),
        parameters=GlobInput.model_json_schema(),
        func=wrapped_func,
    )
    tool._input_schema_class = GlobInput
    return tool
