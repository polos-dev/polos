"""Sandbox tools factory.

Creates a set of tools (exec, read, write, edit, glob, grep) that share
a lazily-initialized execution environment via closure. The environment
is created on first tool use and reused for all subsequent calls.

Example::

    from polos import Agent, sandbox_tools

    agent = Agent(
        id="solver",
        tools=sandbox_tools(SandboxToolsConfig(
            env="docker",
            docker=DockerEnvironmentConfig(
                image="node:20",
                workspace_dir="/path/to/project",
            ),
        )),
    )
"""

from __future__ import annotations

import asyncio
import os

from ..tools.tool import Tool
from .docker import DockerEnvironment
from .environment import ExecutionEnvironment
from .local import LocalEnvironment
from .tools.edit import create_edit_tool
from .tools.exec import create_exec_tool
from .tools.glob import create_glob_tool
from .tools.grep import create_grep_tool
from .tools.path_approval import PathRestrictionConfig
from .tools.read import create_read_tool
from .tools.write import create_write_tool
from .types import (
    DockerEnvironmentConfig,
    ExecToolConfig,
    SandboxToolsConfig,
)


class SandboxToolsResult(list):
    """Return type for sandbox_tools -- a list of Tool with a cleanup method."""

    async def cleanup(self) -> None:
        """Destroy the shared execution environment (remove container, etc.)."""
        ...


def _create_environment(config: SandboxToolsConfig | None) -> ExecutionEnvironment:
    """Create an execution environment from config.

    Args:
        config: Sandbox tools configuration.

    Returns:
        An ExecutionEnvironment instance (not yet initialized).

    Raises:
        ValueError: If environment type is unknown or not yet implemented.
    """
    env_type = (config.env if config else None) or "docker"

    if env_type == "docker":
        docker_config = (config.docker if config else None) or DockerEnvironmentConfig(
            image="node:20-slim",
            workspace_dir=os.getcwd(),
        )
        max_output_chars = config.exec.max_output_chars if (config and config.exec) else None
        return DockerEnvironment(docker_config, max_output_chars)
    elif env_type == "e2b":
        raise NotImplementedError("E2B environment is not yet implemented.")
    elif env_type == "local":
        local_config = config.local if config else None
        max_output_chars = config.exec.max_output_chars if (config and config.exec) else None
        return LocalEnvironment(local_config, max_output_chars)
    else:
        raise ValueError(f"Unknown environment type: {env_type}")


def sandbox_tools(config: SandboxToolsConfig | None = None) -> SandboxToolsResult:
    """Create sandbox tools for AI agents.

    Returns a list of Tool that can be passed directly to Agent().
    All tools share a single execution environment that is lazily created on first use.

    The returned list has a ``cleanup()`` method for destroying the environment.

    Args:
        config: Optional sandbox tools configuration.

    Returns:
        SandboxToolsResult -- a list of Tool instances with a cleanup() method.
    """
    # Lazy environment -- created on first tool use
    env: ExecutionEnvironment | None = None
    env_future: asyncio.Task[ExecutionEnvironment] | None = None
    _lock = asyncio.Lock()

    async def get_env() -> ExecutionEnvironment:
        nonlocal env, env_future

        if env is not None:
            return env

        async with _lock:
            # Double-check after acquiring lock
            if env is not None:
                return env

            if env_future is None:

                async def _init() -> ExecutionEnvironment:
                    nonlocal env
                    created = _create_environment(config)
                    await created.initialize()
                    env = created
                    return env

                env_future = asyncio.ensure_future(_init())

            return await env_future

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

    # For local mode, default file-mutating tools (write, edit) to approval-always
    file_approval = (config.file_approval if config else None) or (
        "always" if env_type == "local" else None
    )

    # Path restriction for read-only tools (read, glob, grep) -- approval gate
    path_config: PathRestrictionConfig | None = None
    if config and config.local and config.local.path_restriction:
        path_config = PathRestrictionConfig(path_restriction=config.local.path_restriction)

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
        tools.append(create_write_tool(get_env, file_approval))
    if "edit" in include:
        tools.append(create_edit_tool(get_env, file_approval))
    if "glob" in include:
        tools.append(create_glob_tool(get_env, path_config))
    if "grep" in include:
        tools.append(create_grep_tool(get_env, path_config))

    # Create result with cleanup method
    result = SandboxToolsResult(tools)

    async def _cleanup() -> None:
        nonlocal env, env_future
        if env is not None:
            await env.destroy()
            env = None
            env_future = None

    result.cleanup = _cleanup  # type: ignore[attr-defined]

    return result
