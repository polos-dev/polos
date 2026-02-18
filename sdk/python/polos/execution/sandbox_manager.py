"""SandboxManager — manages sandbox creation, reuse, auto-cleanup,
and orphan detection. Lives on the Worker.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import TYPE_CHECKING

from .sandbox import ManagedSandbox, Sandbox
from .types import SandboxToolsConfig

if TYPE_CHECKING:
    from ..runtime.client import PolosClient

logger = logging.getLogger(__name__)

# Default idle sweep interval: 10 minutes.
DEFAULT_SWEEP_INTERVAL_S = 10 * 60

# Default idle destroy timeout: 1 hour.
DEFAULT_IDLE_TIMEOUT = "1h"

# Grace period before removing orphan containers (30 minutes).
ORPHAN_GRACE_PERIOD_S = 30 * 60

_DURATION_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*(m|h|d)$")


def parse_duration(s: str) -> float:
    """Parse a human-readable duration string to seconds.

    Supports: ``'30m'``, ``'1h'``, ``'24h'``, ``'3d'``.

    Returns:
        Duration in seconds.

    Raises:
        ValueError: If the format is invalid.
    """
    match = _DURATION_RE.match(s.strip())
    if not match:
        raise ValueError(f'Invalid duration: "{s}". Expected format: "1h", "24h", "3d", etc.')
    value = float(match.group(1))
    unit = match.group(2)
    if unit == "m":
        return value * 60
    elif unit == "h":
        return value * 3600
    elif unit == "d":
        return value * 86400
    raise ValueError(f'Unknown duration unit: "{unit}"')


class SandboxManager:
    """Manages sandbox lifecycle across executions.

    Handles sandbox creation, reuse for session-scoped sandboxes,
    idle cleanup sweeps, and orphan container detection.
    """

    def __init__(
        self,
        worker_id: str,
        project_id: str,
        orchestrator_client: PolosClient | None = None,
    ) -> None:
        self._worker_id = worker_id
        self._project_id = project_id
        self._orchestrator_client = orchestrator_client

        self._sandboxes: dict[str, ManagedSandbox] = {}
        self._session_sandboxes: dict[str, ManagedSandbox] = {}
        self._session_creation_locks: dict[str, asyncio.Lock] = {}
        self._sweep_task: asyncio.Task[None] | None = None

    def set_worker_id(self, worker_id: str) -> None:
        """Update the worker ID (called after registration or re-registration)."""
        self._worker_id = worker_id

    # -- Public API --

    async def get_or_create_sandbox(
        self,
        config: SandboxToolsConfig,
        execution_id: str,
        session_id: str | None = None,
    ) -> Sandbox:
        """Create or retrieve a sandbox.

        - Session-scoped: returns existing sandbox for the session if available.
        - Execution-scoped: always creates a new sandbox.
        """
        scope = config.scope or "execution"

        if scope == "session":
            if not session_id:
                raise ValueError("session_id is required for session-scoped sandboxes")

            # Check for existing sandbox
            existing = self._session_sandboxes.get(session_id)
            if existing and not existing.destroyed:
                existing.attach_execution(execution_id)
                return existing

            # Serialize concurrent creation for the same session
            if session_id not in self._session_creation_locks:
                self._session_creation_locks[session_id] = asyncio.Lock()
            lock = self._session_creation_locks[session_id]

            async with lock:
                # Double-check after acquiring lock
                existing = self._session_sandboxes.get(session_id)
                if existing and not existing.destroyed:
                    existing.attach_execution(execution_id)
                    return existing

                sandbox = self._create_session_sandbox(config, execution_id, session_id)
                return sandbox

        # Execution-scoped: always new
        return self._create_execution_sandbox(config, execution_id)

    async def on_execution_complete(self, execution_id: str) -> None:
        """Notify that an execution completed.

        Triggers cleanup for execution-scoped sandboxes.
        """
        for sandbox_id, sandbox in list(self._sandboxes.items()):
            if execution_id not in sandbox._active_execution_ids:
                continue

            sandbox.detach_execution(execution_id)

            # Execution-scoped sandboxes are 1:1 with executions — destroy immediately.
            # Session-scoped sandboxes survive; they're cleaned up by the idle sweep.
            if sandbox.scope == "execution":
                await self._destroy_and_remove(sandbox_id, sandbox)

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        """Destroy a specific sandbox by ID."""
        sandbox = self._sandboxes.get(sandbox_id)
        if sandbox:
            await self._destroy_and_remove(sandbox_id, sandbox)

    async def destroy_all(self) -> None:
        """Destroy all managed sandboxes. Called during worker shutdown."""
        entries = list(self._sandboxes.items())
        results = await asyncio.gather(
            *(self._safe_destroy(sandbox_id, sandbox) for sandbox_id, sandbox in entries),
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Error during destroy_all: %s", r)
        self._sandboxes.clear()
        self._session_sandboxes.clear()

    def start_sweep(self, interval_s: float = DEFAULT_SWEEP_INTERVAL_S) -> None:
        """Start periodic sweep. Each cycle:

        1. Destroys own sandboxes idle past their idle_destroy_timeout.
        2. Removes orphan Docker containers from dead workers (orchestrator-based).
        """
        self.stop_sweep()
        self._sweep_task = asyncio.create_task(self._sweep_loop(interval_s))

    def stop_sweep(self) -> None:
        """Stop the periodic sweep."""
        if self._sweep_task is not None:
            self._sweep_task.cancel()
            self._sweep_task = None

    def get_sandbox(self, sandbox_id: str) -> Sandbox | None:
        """Lookup a sandbox by ID."""
        return self._sandboxes.get(sandbox_id)

    def get_session_sandbox(self, session_id: str) -> Sandbox | None:
        """Lookup a session sandbox by session ID."""
        return self._session_sandboxes.get(session_id)

    # -- Private helpers --

    def _create_execution_sandbox(
        self, config: SandboxToolsConfig, execution_id: str
    ) -> ManagedSandbox:
        sandbox = ManagedSandbox(config, self._worker_id, self._project_id)
        sandbox.attach_execution(execution_id)
        self._sandboxes[sandbox.id] = sandbox
        return sandbox

    def _create_session_sandbox(
        self, config: SandboxToolsConfig, execution_id: str, session_id: str
    ) -> ManagedSandbox:
        sandbox = ManagedSandbox(config, self._worker_id, self._project_id, session_id)
        sandbox.attach_execution(execution_id)
        self._sandboxes[sandbox.id] = sandbox
        self._session_sandboxes[session_id] = sandbox
        return sandbox

    async def _destroy_and_remove(self, sandbox_id: str, sandbox: ManagedSandbox) -> None:
        await sandbox.destroy()
        self._sandboxes.pop(sandbox_id, None)

        if sandbox.session_id:
            current = self._session_sandboxes.get(sandbox.session_id)
            if current is sandbox:
                self._session_sandboxes.pop(sandbox.session_id, None)

    async def _safe_destroy(self, sandbox_id: str, sandbox: ManagedSandbox) -> None:
        try:
            await sandbox.destroy()
        except Exception as exc:
            logger.warning("Failed to destroy sandbox %s: %s", sandbox_id, exc)

    async def _sweep_loop(self, interval_s: float) -> None:
        """Background task that periodically sweeps idle/orphan sandboxes."""
        try:
            while True:
                await asyncio.sleep(interval_s)
                try:
                    await self._sweep()
                except Exception as exc:
                    logger.warning("Sweep error: %s", exc)
        except asyncio.CancelledError:
            pass

    async def _sweep(self) -> None:
        """Unified sweep: Phase 1 cleans own idle sandboxes, Phase 2 cleans orphan containers."""
        await self._sweep_idle_sandboxes()
        await self._sweep_orphan_containers()

    async def _sweep_idle_sandboxes(self) -> None:
        """Phase 1: Destroy own sandboxes that have been idle past their timeout."""
        now = time.monotonic()

        for sandbox_id, sandbox in list(self._sandboxes.items()):
            timeout_str = sandbox.config.idle_destroy_timeout or DEFAULT_IDLE_TIMEOUT
            timeout_s = parse_duration(timeout_str)
            idle_s = now - sandbox.last_activity_at

            if idle_s > timeout_s:
                logger.info(
                    "Destroying idle sandbox %s (scope=%s, session=%s, idle %ds)",
                    sandbox_id,
                    sandbox.scope,
                    sandbox.session_id or "none",
                    int(idle_s),
                )
                try:
                    await self._destroy_and_remove(sandbox_id, sandbox)
                except Exception as exc:
                    logger.warning("Failed to destroy idle sandbox %s: %s", sandbox_id, exc)

    async def _sweep_orphan_containers(self) -> None:
        """Phase 2: Remove Docker containers from dead workers.

        Queries the orchestrator for active worker IDs, lists all polos-managed
        Docker containers, and removes any whose worker-id is not in the active set
        AND whose age exceeds ORPHAN_GRACE_PERIOD_S.
        """
        if self._orchestrator_client is None:
            return

        try:
            active_worker_ids = await self._get_active_worker_ids()
        except Exception as exc:
            logger.warning("Failed to query active workers, skipping orphan cleanup: %s", exc)
            return

        try:
            proc = await asyncio.create_subprocess_exec(
                "docker",
                "ps",
                "-a",
                "--filter",
                "label=polos.managed=true",
                "--format",
                '{{.Names}}\t{{.Label "polos.worker-id"}}\t{{.CreatedAt}}',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout_bytes, _ = await proc.communicate()
            if proc.returncode != 0 or not stdout_bytes:
                return

            now = time.time()
            for line in stdout_bytes.decode().strip().split("\n"):
                if not line:
                    continue
                parts = line.split("\t")
                if len(parts) < 3:
                    continue
                name, worker_id, created_at = parts[0], parts[1], parts[2]
                if not name or not worker_id:
                    continue

                # Skip containers belonging to active workers
                if worker_id in active_worker_ids:
                    continue

                # Skip containers younger than the grace period
                try:
                    from datetime import datetime

                    # Docker CreatedAt format varies, try ISO-style parse
                    container_created = datetime.fromisoformat(
                        created_at.replace(" +", "+").replace(" -", "-")
                    ).timestamp()
                    container_age = now - container_created
                    if container_age < ORPHAN_GRACE_PERIOD_S:
                        continue
                except (ValueError, TypeError):
                    continue

                logger.info("Removing orphaned container: %s (worker: %s)", name, worker_id)
                try:
                    rm_proc = await asyncio.create_subprocess_exec(
                        "docker",
                        "rm",
                        "-f",
                        name,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await rm_proc.communicate()
                except Exception as exc:
                    logger.warning("Failed to remove orphaned container %s: %s", name, exc)

        except Exception as exc:
            logger.warning("Failed to sweep orphan containers: %s", exc)

    async def _get_active_worker_ids(self) -> set[str]:
        """Query orchestrator for active worker IDs."""
        if self._orchestrator_client is None:
            return set()

        import httpx

        headers = self._orchestrator_client._get_headers()
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{self._orchestrator_client.api_url}/api/v1/workers/active",
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            return set(data.get("worker_ids", []))
