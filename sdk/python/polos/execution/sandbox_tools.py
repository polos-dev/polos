"""Sandbox tools factory.

Creates a set of tools (exec, read, write, edit, glob, grep) that share
a lazily-initialized execution environment via the ``SandboxManager``
from the Worker execution context. The environment is created on first
tool use and reused for all subsequent calls within the same execution.

Example::

    from polos import Agent, sandbox_tools

    agent = Agent(
        id="solver",
        tools=sandbox_tools(SandboxToolsConfig(
            env="docker",
            docker=DockerEnvironmentConfig(image="node:20"),
        )),
    )
"""

from __future__ import annotations

import asyncio

from ..core.workflow import _execution_context
from ..tools.tool import Tool
from .environment import ExecutionEnvironment
from .tools.edit import create_edit_tool
from .tools.exec import create_exec_tool
from .tools.glob import create_glob_tool
from .tools.grep import create_grep_tool
from .tools.path_approval import PathRestrictionConfig
from .tools.read import create_read_tool
from .tools.write import create_write_tool
from .types import (
    ExecToolConfig,
    SandboxToolsConfig,
)


def sandbox_tools(config: SandboxToolsConfig | None = None) -> list[Tool]:
    """Create sandbox tools for AI agents.

    Returns a list of Tool that can be passed directly to Agent().
    All tools share a single execution environment managed by the
    ``SandboxManager`` from the Worker execution context. The environment
    is lazily created on first tool use.

    Args:
        config: Optional sandbox tools configuration.
    """
    # Cache by root_execution_id so the same sandbox is reused across
    # sub-workflows within the same root execution.
    _sandbox_cache: dict[str, ExecutionEnvironment] = {}
    _lock = asyncio.Lock()

    async def get_env() -> ExecutionEnvironment:
        exec_ctx = _execution_context.get()
        if exec_ctx is None:
            raise RuntimeError(
                "sandbox_tools requires a Worker execution context. "
                "Make sure this agent is running inside a Polos Worker."
            )

        sandbox_manager = exec_ctx.get("sandbox_manager")
        if sandbox_manager is None:
            raise RuntimeError(
                "No SandboxManager found in execution context. "
                "Make sure the Worker is configured with sandbox support."
            )

        execution_id = exec_ctx.get("execution_id", "")
        root_execution_id = exec_ctx.get("root_execution_id", execution_id)
        session_id = exec_ctx.get("session_id")

        # Use root_execution_id as the stable key — tool sub-workflows each
        # get their own execution_id, but they all share the same root.
        cache_key = root_execution_id or execution_id
        if cache_key in _sandbox_cache:
            return _sandbox_cache[cache_key]

        # Serialize creation to prevent parallel tool calls from spawning
        # multiple containers for the same execution.
        async with _lock:
            if cache_key in _sandbox_cache:
                return _sandbox_cache[cache_key]

            sandbox = await sandbox_manager.get_or_create_sandbox(
                config or SandboxToolsConfig(),
                cache_key,
                session_id,
            )
            sandbox_env = await sandbox.get_environment()
            _sandbox_cache[cache_key] = sandbox_env
            return sandbox_env

    # Validate environment type eagerly
    env_type = (config.env if config else None) or "docker"
    if env_type == "e2b":
        raise NotImplementedError("E2B environment is not yet implemented.")

    # For local mode, default exec security to 'approval-always' (no sandbox isolation)
    effective_exec_config: ExecToolConfig | None
    if env_type == "local" and not (config and config.exec and config.exec.security):
        base = config.exec if (config and config.exec) else ExecToolConfig()
        effective_exec_config = base.model_copy(update={"security": "approval-always"})
    else:
        effective_exec_config = config.exec if config else None

    # Path restriction -- used by read, write, edit, glob, grep for approval gating
    path_config: PathRestrictionConfig | None = None
    if config and config.local and config.local.path_restriction:
        path_config = PathRestrictionConfig(path_restriction=config.local.path_restriction)

    # file_approval overrides path-restriction behavior for write/edit.
    # 'always' = approve every write/edit regardless of path.
    # 'none' = never approve (skip path restriction too).
    # None = use path restriction (approve only outside cwd).
    file_approval = config.file_approval if config else None

    # Build write/edit config: explicit approval overrides path restriction
    from .tools.edit import EditToolConfig
    from .tools.write import WriteToolConfig

    if file_approval:
        write_edit_config_w = WriteToolConfig(approval=file_approval)
        write_edit_config_e = EditToolConfig(approval=file_approval)
    elif path_config:
        write_edit_config_w = WriteToolConfig(path_config=path_config)
        write_edit_config_e = EditToolConfig(path_config=path_config)
    else:
        write_edit_config_w = None
        write_edit_config_e = None

    # Determine which tools to include
    include = set(
        (config.tools if config and config.tools else None)
        or ["exec", "read", "write", "edit", "glob", "grep"]
    )

    tools: list[Tool] = []

    if "exec" in include:
        tools.append(create_exec_tool(get_env, effective_exec_config))
    if "read" in include:
        tools.append(create_read_tool(get_env, path_config))
    if "write" in include:
        tools.append(create_write_tool(get_env, write_edit_config_w))
    if "edit" in include:
        tools.append(create_edit_tool(get_env, write_edit_config_e))
    if "glob" in include:
        tools.append(create_glob_tool(get_env, path_config))
    if "grep" in include:
        tools.append(create_grep_tool(get_env, path_config))

    return tools
