"""Path-based approval for read-only sandbox tools.

When path_restriction is set, read-only tools (read, glob, grep) allow
operations within the restricted path without approval. Operations
outside the restriction suspend for user approval.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from ...core.context import WorkflowContext
from ..security import is_within_restriction


@dataclass
class PathRestrictionConfig:
    """Configuration for path-restricted approval on read-only tools."""

    path_restriction: str
    """Directory to allow without approval. Paths outside require approval."""


def is_path_allowed(resolved_path: str, restriction: str) -> bool:
    """Check whether a resolved path is within the restriction.

    Args:
        resolved_path: The fully resolved path to check.
        restriction: The restriction directory.

    Returns:
        Whether the path is within the restriction.
    """
    return is_within_restriction(resolved_path, os.path.abspath(restriction))


async def require_path_approval(
    ctx: WorkflowContext,
    tool_name: str,
    target_path: str,
    restriction: str,
) -> None:
    """Suspend for user approval when accessing a path outside the restriction.

    Throws if rejected.

    Args:
        ctx: Workflow context with step helper.
        tool_name: Name of the tool requesting access.
        target_path: The path being accessed.
        restriction: The restriction directory.

    Raises:
        RuntimeError: If the user rejects the operation.
    """
    approval_id = await ctx.step.uuid("_approval_id")
    response: dict[str, Any] = await ctx.step.suspend(
        f"approve_{tool_name}_{approval_id}",
        {
            "_form": {
                "title": f"{tool_name}: access outside workspace",
                "description": f"The agent wants to {tool_name} a path outside the workspace.",
                "fields": [
                    {
                        "key": "approved",
                        "type": "boolean",
                        "label": "Allow this operation?",
                        "required": True,
                        "default": False,
                    },
                    {
                        "key": "feedback",
                        "type": "textarea",
                        "label": "Feedback for the agent (optional)",
                        "description": "If rejecting, tell the agent what to do instead.",
                        "required": False,
                    },
                ],
                "context": {
                    "tool": tool_name,
                    "path": target_path,
                    "restriction": restriction,
                },
            },
            "_source": "path_approval",
            "_tool": tool_name,
        },
    )

    data = response.get("data", {}) if isinstance(response, dict) else {}
    if data.get("approved") is not True:
        feedback = data.get("feedback")
        msg = f'Access to "{target_path}" was rejected by the user.'
        if feedback:
            msg += f" Feedback: {feedback}"
        raise RuntimeError(msg)
