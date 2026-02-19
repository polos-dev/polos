"""Managed sandbox — wraps an ExecutionEnvironment with identity,
lifecycle tracking, and crash recovery.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
import uuid
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from .docker import DockerEnvironment
from .local import LocalEnvironment
from .types import DockerEnvironmentConfig, LocalEnvironmentConfig, SandboxScope, SandboxToolsConfig

if TYPE_CHECKING:
    from .environment import ExecutionEnvironment

logger = logging.getLogger(__name__)

# Default base directory for sandbox workspaces.
DEFAULT_WORKSPACES_DIR = os.path.join(os.path.expanduser("~"), ".polos", "workspaces")

# Environment variable to override the base workspaces directory.
WORKSPACES_DIR_ENV = "POLOS_WORKSPACES_DIR"

# Health check debounce interval in seconds.
HEALTH_CHECK_DEBOUNCE_S = 30


@runtime_checkable
class Sandbox(Protocol):
    """Protocol for a managed sandbox wrapping an ExecutionEnvironment."""

    @property
    def id(self) -> str: ...

    @property
    def scope(self) -> SandboxScope: ...

    @property
    def config(self) -> SandboxToolsConfig: ...

    @property
    def worker_id(self) -> str: ...

    @property
    def session_id(self) -> str | None: ...

    @property
    def active_execution_ids(self) -> frozenset[str]: ...

    @property
    def initialized(self) -> bool: ...

    @property
    def destroyed(self) -> bool: ...

    @property
    def last_activity_at(self) -> float: ...

    async def get_environment(self) -> ExecutionEnvironment: ...

    def attach_execution(self, execution_id: str) -> None: ...

    def detach_execution(self, execution_id: str) -> None: ...

    async def destroy(self) -> None: ...

    async def recreate(self) -> None: ...


class ManagedSandbox:
    """Concrete implementation of the Sandbox protocol.

    Wraps an ``ExecutionEnvironment`` with identity, lifecycle tracking,
    lazy initialization with call coalescing, health checks, and crash recovery.
    """

    def __init__(
        self,
        config: SandboxToolsConfig,
        worker_id: str,
        project_id: str,
        session_id: str | None = None,
    ) -> None:
        self._id = config.id or f"sandbox-{uuid.uuid4().hex[:8]}"
        self._scope: SandboxScope = config.scope or "execution"
        self._config = config
        self._worker_id = worker_id
        self._project_id = project_id
        self._session_id = session_id

        self._active_execution_ids: set[str] = set()
        self._last_activity_at = time.monotonic()
        self._destroyed = False

        self._env: ExecutionEnvironment | None = None
        self._env_future: asyncio.Future[ExecutionEnvironment] | None = None
        self._last_health_check_at: float = 0

    # -- Properties (matching the Sandbox protocol) --

    @property
    def id(self) -> str:
        return self._id

    @property
    def scope(self) -> SandboxScope:
        return self._scope

    @property
    def config(self) -> SandboxToolsConfig:
        return self._config

    @property
    def worker_id(self) -> str:
        return self._worker_id

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def active_execution_ids(self) -> frozenset[str]:
        return frozenset(self._active_execution_ids)

    @property
    def initialized(self) -> bool:
        return self._env is not None

    @property
    def destroyed(self) -> bool:
        return self._destroyed

    @property
    def last_activity_at(self) -> float:
        return self._last_activity_at

    def set_worker_id(self, worker_id: str) -> None:
        self._worker_id = worker_id

    # -- Core lifecycle --

    async def get_environment(self) -> ExecutionEnvironment:
        if self._destroyed:
            raise RuntimeError(f"Sandbox {self._id} has been destroyed")

        self._last_activity_at = time.monotonic()

        # If environment exists, optionally health-check
        if self._env is not None:
            await self._health_check()
            return self._env

        # Coalesce concurrent init calls
        if self._env_future is not None:
            return await self._env_future

        loop = asyncio.get_running_loop()
        self._env_future = loop.create_future()
        try:
            env = await self._initialize_environment()
            self._env = env
            self._env_future.set_result(env)
            return env
        except Exception as exc:
            self._env_future.set_exception(exc)
            raise
        finally:
            # Clear future so next attempt can retry on failure
            self._env_future = None

    def attach_execution(self, execution_id: str) -> None:
        self._active_execution_ids.add(execution_id)

    def detach_execution(self, execution_id: str) -> None:
        self._active_execution_ids.discard(execution_id)

    async def destroy(self) -> None:
        if self._destroyed:
            return
        self._destroyed = True

        if self._env is not None:
            try:
                await self._env.destroy()
            except Exception as exc:
                logger.warning("Failed to destroy environment for sandbox %s: %s", self._id, exc)
            self._env = None
            self._env_future = None

    async def recreate(self) -> None:
        logger.info("Recreating sandbox %s", self._id)

        # Best-effort destroy old env
        if self._env is not None:
            with contextlib.suppress(Exception):
                await self._env.destroy()

        self._env = None
        self._env_future = None
        self._destroyed = False
        self._last_health_check_at = 0
        # Next get_environment() call will re-initialize

    # -- Private helpers --

    def _get_default_workspace_dir(self) -> str:
        base = os.environ.get(WORKSPACES_DIR_ENV, DEFAULT_WORKSPACES_DIR)
        leaf = self._session_id or self._id
        return os.path.join(base, self._project_id, leaf)

    async def _initialize_environment(self) -> ExecutionEnvironment:
        env_type = self._config.env or "docker"

        if env_type == "docker":
            docker_config = self._config.docker or DockerEnvironmentConfig(
                image="node:20-slim",
                workspace_dir=self._get_default_workspace_dir(),
            )

            # Use default workspace dir if not specified in config
            workspace_dir = docker_config.workspace_dir or self._get_default_workspace_dir()
            docker_config = docker_config.model_copy(update={"workspace_dir": workspace_dir})

            # Ensure workspace directory exists on host before bind-mounting
            os.makedirs(workspace_dir, exist_ok=True)

            max_output_chars = self._config.exec.max_output_chars if self._config.exec else None
            env = DockerEnvironment(docker_config, max_output_chars)

            # Build labels for lifecycle management and orphan detection
            labels: dict[str, str] = {
                "polos.managed": "true",
                "polos.sandbox-id": self._id,
                "polos.worker-id": self._worker_id,
            }
            if self._session_id:
                labels["polos.session-id"] = self._session_id

            await env.initialize(labels)
            return env

        elif env_type == "local":
            local_config = self._config.local or LocalEnvironmentConfig()
            local_cwd = local_config.cwd or self._get_default_workspace_dir()
            os.makedirs(local_cwd, exist_ok=True)
            # Default path_restriction to cwd; set to False to explicitly disable
            if local_config.path_restriction is False:
                path_restriction = None
            else:
                path_restriction = local_config.path_restriction or local_cwd
            local_config = local_config.model_copy(
                update={"cwd": local_cwd, "path_restriction": path_restriction}
            )
            max_output_chars = self._config.exec.max_output_chars if self._config.exec else None
            env = LocalEnvironment(local_config, max_output_chars)
            await env.initialize()
            return env

        elif env_type == "e2b":
            raise NotImplementedError("E2B environment is not yet implemented.")

        else:
            raise ValueError(f"Unknown environment type: {env_type}")

    async def _health_check(self) -> None:
        """Health check with 30s debounce. Only probes Docker containers."""
        if self._env is None:
            return
        if self._env.type != "docker":
            return

        now = time.monotonic()
        if now - self._last_health_check_at < HEALTH_CHECK_DEBOUNCE_S:
            return

        self._last_health_check_at = now

        try:
            await self._env.exec("true", None)
        except Exception as exc:
            msg = str(exc)
            if "No such container" in msg or "is not running" in msg:
                logger.warning("Container for sandbox %s is dead, recreating: %s", self._id, msg)
                await self.recreate()
                # Re-initialize immediately so caller gets a working env
                await self.get_environment()
            # Other errors (e.g., timeout) — don't recreate, let the actual tool call fail
