"""Exec tool -- run shell commands inside the execution environment."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, Field

from ...core.context import WorkflowContext
from ...tools.tool import Tool
from ..environment import ExecutionEnvironment
from ..security import evaluate_allowlist
from ..types import ExecToolConfig


class ExecInput(BaseModel):
    """Input schema for the exec tool."""

    command: str = Field(description="The shell command to execute")
    cwd: str | None = Field(default=None, description="Working directory for the command")
    env: dict[str, str] | None = Field(default=None, description="Environment variables to set")
    timeout: int | None = Field(default=None, description="Timeout in seconds (default: 300)")


async def _request_approval(
    ctx: WorkflowContext,
    command: str,
    env: ExecutionEnvironment,
) -> dict[str, Any]:
    """Suspend for user approval of a command.

    Returns:
        Dict with 'approved' (bool) and optional 'feedback' (str).
    """
    env_info = env.get_info()
    approval_id = await ctx.step.uuid("_approval_id")
    response: dict[str, Any] = await ctx.step.suspend(
        f"approve_exec_{approval_id}",
        {
            "_form": {
                "title": "Approve command execution",
                "description": (
                    f"The agent wants to run a shell command in the "
                    f"{env_info.type} environment."
                ),
                "fields": [
                    {
                        "key": "approved",
                        "type": "boolean",
                        "label": "Approve this command?",
                        "required": True,
                        "default": False,
                    },
                    {
                        "key": "allow_always",
                        "type": "boolean",
                        "label": "Always allow this command in the future?",
                        "required": False,
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
                    "command": command,
                    "cwd": env.get_cwd(),
                    "environment": env_info.type,
                },
            },
            "_source": "exec_security",
            "_tool": "exec",
        },
    )

    data = response.get("data", {}) if isinstance(response, dict) else {}
    feedback = data.get("feedback")
    return {
        "approved": data.get("approved") is True,
        **({"feedback": feedback} if feedback else {}),
    }


def _rejected_result(command: str, feedback: str | None = None) -> dict[str, Any]:
    """Build a rejected ExecResult as a dict.

    Includes user feedback in stderr so the agent can adjust its approach.
    """
    stderr = f"Command rejected by user: {command}"
    if feedback:
        stderr += f"\nUser feedback: {feedback}"
    return {
        "exit_code": -1,
        "stdout": "",
        "stderr": stderr,
        "duration_ms": 0,
        "truncated": False,
    }


def create_exec_tool(
    get_env: Callable[[], Awaitable[ExecutionEnvironment]],
    config: ExecToolConfig | None = None,
) -> Tool:
    """Create the exec tool for running shell commands.

    Args:
        get_env: Async callable that returns the shared ExecutionEnvironment.
        config: Optional exec tool configuration (security mode, allowlist, etc.).

    Returns:
        A Tool instance for exec.
    """

    async def handler(ctx: WorkflowContext, input: ExecInput) -> dict[str, Any]:
        env = await get_env()

        # Security gate
        security = config.security if config else None
        if security == "approval-always":
            result = await _request_approval(ctx, input.command, env)
            if not result["approved"]:
                return _rejected_result(input.command, result.get("feedback"))
        elif security == "allowlist":
            allowlist = config.allowlist if config else None
            if not evaluate_allowlist(input.command, allowlist or []):
                result = await _request_approval(ctx, input.command, env)
                if not result["approved"]:
                    return _rejected_result(input.command, result.get("feedback"))
        # 'allow-always' or None -> no check

        from ..types import ExecOptions

        exec_result = await env.exec(
            input.command,
            ExecOptions(
                cwd=input.cwd,
                env=input.env,
                timeout=input.timeout or (config.timeout if config else None),
            ),
        )
        return exec_result.model_dump()

    async def wrapped_func(ctx: WorkflowContext, payload: dict[str, Any] | None):
        input_obj = ExecInput.model_validate(payload) if payload else ExecInput(command="")
        return await handler(ctx, input_obj)

    tool = Tool(
        id="exec",
        description=(
            "Execute a shell command in the sandbox environment. Returns stdout, stderr, "
            "and exit code. Use this for running builds, tests, installing packages, or "
            "any shell operation."
        ),
        parameters=ExecInput.model_json_schema(),
        func=wrapped_func,
    )
    tool._input_schema_class = ExecInput
    return tool
