"""Tests for the SandboxManager class."""

import asyncio
import time

import pytest

from polos.execution.sandbox_manager import (
    SandboxManager,
    parse_duration,
)
from polos.execution.types import SandboxToolsConfig

# ── parse_duration tests ─────────────────────────────────────────────────


class TestParseDuration:
    """Tests for the parse_duration utility."""

    def test_parses_minutes(self):
        """Parses minute durations."""
        assert parse_duration("30m") == 1800

    def test_parses_hours(self):
        """Parses hour durations."""
        assert parse_duration("1h") == 3600

    def test_parses_fractional_hours(self):
        """Parses fractional hour durations."""
        assert parse_duration("1.5h") == 5400

    def test_parses_days(self):
        """Parses day durations."""
        assert parse_duration("3d") == 259200

    def test_parses_24h(self):
        """Parses 24h as 24 hours."""
        assert parse_duration("24h") == 86400

    def test_strips_whitespace(self):
        """Strips leading/trailing whitespace."""
        assert parse_duration("  1h  ") == 3600

    def test_rejects_invalid_format(self):
        """Invalid formats raise ValueError."""
        with pytest.raises(ValueError, match="Invalid duration"):
            parse_duration("abc")

    def test_rejects_empty_string(self):
        """Empty string raises ValueError."""
        with pytest.raises(ValueError, match="Invalid duration"):
            parse_duration("")

    def test_rejects_no_unit(self):
        """Number without unit raises ValueError."""
        with pytest.raises(ValueError, match="Invalid duration"):
            parse_duration("123")

    def test_rejects_unknown_unit(self):
        """Unknown unit raises ValueError."""
        with pytest.raises(ValueError, match="Invalid duration"):
            parse_duration("1s")

    def test_zero_value(self):
        """Zero value is valid."""
        assert parse_duration("0h") == 0


# ── SandboxManager construction tests ────────────────────────────────────


class TestSandboxManagerInit:
    """Tests for SandboxManager construction."""

    def test_stores_worker_and_project_ids(self):
        """Worker and project IDs are stored."""
        mgr = SandboxManager("worker-1", "project-1")
        assert mgr._worker_id == "worker-1"
        assert mgr._project_id == "project-1"

    def test_starts_with_no_sandboxes(self):
        """Starts with empty sandbox maps."""
        mgr = SandboxManager("worker-1", "project-1")
        assert len(mgr._sandboxes) == 0
        assert len(mgr._session_sandboxes) == 0

    def test_set_worker_id(self):
        """Worker ID can be updated."""
        mgr = SandboxManager("old-worker", "project-1")
        mgr.set_worker_id("new-worker")
        assert mgr._worker_id == "new-worker"


# ── get_or_create_sandbox tests ──────────────────────────────────────────


class TestSandboxManagerGetOrCreate:
    """Tests for get_or_create_sandbox."""

    @pytest.mark.asyncio
    async def test_execution_scope_creates_new_sandbox(self):
        """Execution-scoped config always creates a new sandbox."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="execution")

        sandbox = await mgr.get_or_create_sandbox(config, "exec-1")
        assert sandbox.scope == "execution"
        assert "exec-1" in sandbox.active_execution_ids
        assert sandbox.id in mgr._sandboxes

    @pytest.mark.asyncio
    async def test_execution_scope_creates_distinct_sandboxes(self):
        """Each call for execution scope creates a different sandbox."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="execution")

        sb1 = await mgr.get_or_create_sandbox(config, "exec-1")
        sb2 = await mgr.get_or_create_sandbox(config, "exec-2")
        assert sb1.id != sb2.id

    @pytest.mark.asyncio
    async def test_default_scope_is_execution(self):
        """Default scope (None) is treated as execution."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker")

        sandbox = await mgr.get_or_create_sandbox(config, "exec-1")
        assert sandbox.scope == "execution"

    @pytest.mark.asyncio
    async def test_session_scope_requires_session_id(self):
        """Session scope without session_id raises ValueError."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")

        with pytest.raises(ValueError, match="session_id is required"):
            await mgr.get_or_create_sandbox(config, "exec-1")

    @pytest.mark.asyncio
    async def test_session_scope_creates_sandbox(self):
        """Session scope creates a sandbox with session tracking."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")

        sandbox = await mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1")
        assert sandbox.scope == "session"
        assert sandbox.session_id == "sess-1"
        assert "exec-1" in sandbox.active_execution_ids
        assert "sess-1" in mgr._session_sandboxes

    @pytest.mark.asyncio
    async def test_session_scope_reuses_existing_sandbox(self):
        """Second call with same session_id returns the same sandbox."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")

        sb1 = await mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1")
        sb2 = await mgr.get_or_create_sandbox(config, "exec-2", session_id="sess-1")
        assert sb1 is sb2
        assert sb1.active_execution_ids == frozenset({"exec-1", "exec-2"})

    @pytest.mark.asyncio
    async def test_session_scope_creates_new_if_destroyed(self):
        """If the existing session sandbox is destroyed, a new one is created."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")

        sb1 = await mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1")
        await sb1.destroy()

        sb2 = await mgr.get_or_create_sandbox(config, "exec-2", session_id="sess-1")
        assert sb2 is not sb1
        assert sb2.id != sb1.id

    @pytest.mark.asyncio
    async def test_different_sessions_get_different_sandboxes(self):
        """Different session IDs get different sandboxes."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")

        sb1 = await mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1")
        sb2 = await mgr.get_or_create_sandbox(config, "exec-2", session_id="sess-2")
        assert sb1 is not sb2
        assert sb1.id != sb2.id


# ── on_execution_complete tests ──────────────────────────────────────────


class TestSandboxManagerOnExecutionComplete:
    """Tests for on_execution_complete."""

    @pytest.mark.asyncio
    async def test_detaches_execution_from_sandbox(self):
        """Execution is detached from its sandbox."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="execution")

        sandbox = await mgr.get_or_create_sandbox(config, "exec-1")
        assert "exec-1" in sandbox.active_execution_ids

        await mgr.on_execution_complete("exec-1")
        assert "exec-1" not in sandbox.active_execution_ids

    @pytest.mark.asyncio
    async def test_destroys_execution_scoped_sandbox(self):
        """Execution-scoped sandbox is destroyed on completion."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="execution")

        sandbox = await mgr.get_or_create_sandbox(config, "exec-1")
        sandbox_id = sandbox.id

        await mgr.on_execution_complete("exec-1")
        assert sandbox.destroyed is True
        assert sandbox_id not in mgr._sandboxes

    @pytest.mark.asyncio
    async def test_preserves_session_scoped_sandbox(self):
        """Session-scoped sandbox survives execution completion."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")

        sandbox = await mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1")
        sandbox_id = sandbox.id

        await mgr.on_execution_complete("exec-1")
        assert sandbox.destroyed is False
        assert sandbox_id in mgr._sandboxes
        assert "sess-1" in mgr._session_sandboxes

    @pytest.mark.asyncio
    async def test_noop_for_unknown_execution(self):
        """on_execution_complete is a no-op for unknown execution IDs."""
        mgr = SandboxManager("worker-1", "project-1")
        await mgr.on_execution_complete("nonexistent")  # Should not raise


# ── destroy_sandbox / destroy_all tests ──────────────────────────────────


class TestSandboxManagerDestroy:
    """Tests for destroy_sandbox and destroy_all."""

    @pytest.mark.asyncio
    async def test_destroy_sandbox_removes_from_maps(self):
        """destroy_sandbox removes the sandbox from all tracking maps."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")

        sandbox = await mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1")
        sandbox_id = sandbox.id

        await mgr.destroy_sandbox(sandbox_id)
        assert sandbox.destroyed is True
        assert sandbox_id not in mgr._sandboxes
        assert "sess-1" not in mgr._session_sandboxes

    @pytest.mark.asyncio
    async def test_destroy_sandbox_noop_for_unknown(self):
        """destroy_sandbox is a no-op for unknown IDs."""
        mgr = SandboxManager("worker-1", "project-1")
        await mgr.destroy_sandbox("nonexistent")  # Should not raise

    @pytest.mark.asyncio
    async def test_destroy_all_clears_everything(self):
        """destroy_all destroys all sandboxes and clears maps."""
        mgr = SandboxManager("worker-1", "project-1")
        config_exec = SandboxToolsConfig(env="docker", scope="execution")
        config_sess = SandboxToolsConfig(env="docker", scope="session")

        sb1 = await mgr.get_or_create_sandbox(config_exec, "exec-1")
        sb2 = await mgr.get_or_create_sandbox(config_sess, "exec-2", session_id="sess-1")

        await mgr.destroy_all()
        assert sb1.destroyed is True
        assert sb2.destroyed is True
        assert len(mgr._sandboxes) == 0
        assert len(mgr._session_sandboxes) == 0


# ── Lookup tests ─────────────────────────────────────────────────────────


class TestSandboxManagerLookup:
    """Tests for get_sandbox and get_session_sandbox."""

    @pytest.mark.asyncio
    async def test_get_sandbox_returns_sandbox(self):
        """get_sandbox returns the correct sandbox."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker")
        sandbox = await mgr.get_or_create_sandbox(config, "exec-1")

        result = mgr.get_sandbox(sandbox.id)
        assert result is sandbox

    @pytest.mark.asyncio
    async def test_get_sandbox_returns_none_for_unknown(self):
        """get_sandbox returns None for unknown ID."""
        mgr = SandboxManager("worker-1", "project-1")
        assert mgr.get_sandbox("nonexistent") is None

    @pytest.mark.asyncio
    async def test_get_session_sandbox_returns_sandbox(self):
        """get_session_sandbox returns the session sandbox."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")
        sandbox = await mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1")

        result = mgr.get_session_sandbox("sess-1")
        assert result is sandbox

    @pytest.mark.asyncio
    async def test_get_session_sandbox_returns_none_for_unknown(self):
        """get_session_sandbox returns None for unknown session."""
        mgr = SandboxManager("worker-1", "project-1")
        assert mgr.get_session_sandbox("nonexistent") is None


# ── Sweep start/stop tests ──────────────────────────────────────────────


class TestSandboxManagerSweep:
    """Tests for sweep start/stop."""

    @pytest.mark.asyncio
    async def test_start_sweep_creates_task(self):
        """start_sweep creates a background task."""
        mgr = SandboxManager("worker-1", "project-1")
        mgr.start_sweep(interval_s=3600)
        assert mgr._sweep_task is not None
        mgr.stop_sweep()

    @pytest.mark.asyncio
    async def test_stop_sweep_cancels_task(self):
        """stop_sweep cancels the background task."""
        mgr = SandboxManager("worker-1", "project-1")
        mgr.start_sweep(interval_s=3600)
        mgr.stop_sweep()
        assert mgr._sweep_task is None

    def test_stop_sweep_without_start_is_safe(self):
        """stop_sweep without start_sweep is a no-op."""
        mgr = SandboxManager("worker-1", "project-1")
        mgr.stop_sweep()  # Should not raise

    @pytest.mark.asyncio
    async def test_start_sweep_replaces_previous(self):
        """Calling start_sweep again replaces the previous task."""
        mgr = SandboxManager("worker-1", "project-1")
        mgr.start_sweep(interval_s=3600)
        task1 = mgr._sweep_task
        mgr.start_sweep(interval_s=3600)
        task2 = mgr._sweep_task
        assert task1 is not task2
        # Allow the cancelled task to process its cancellation
        await asyncio.sleep(0)
        assert task1.cancelled()
        mgr.stop_sweep()


# ── Idle sweep logic tests ──────────────────────────────────────────────


class TestSandboxManagerIdleSweep:
    """Tests for _sweep_idle_sandboxes."""

    @pytest.mark.asyncio
    async def test_destroys_idle_sandbox(self):
        """Sandbox idle past timeout is destroyed."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", idle_destroy_timeout="1m")
        sandbox = await mgr.get_or_create_sandbox(config, "exec-1")

        # Make it look idle (activity 2 minutes ago)
        sandbox._last_activity_at = time.monotonic() - 120

        await mgr._sweep_idle_sandboxes()
        assert sandbox.destroyed is True
        assert sandbox.id not in mgr._sandboxes

    @pytest.mark.asyncio
    async def test_preserves_active_sandbox(self):
        """Sandbox within timeout is preserved."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", idle_destroy_timeout="1h")
        sandbox = await mgr.get_or_create_sandbox(config, "exec-1")

        # Activity was just now
        sandbox._last_activity_at = time.monotonic()

        await mgr._sweep_idle_sandboxes()
        assert sandbox.destroyed is False
        assert sandbox.id in mgr._sandboxes

    @pytest.mark.asyncio
    async def test_uses_default_timeout_when_not_specified(self):
        """Default idle timeout is used when config doesn't specify one."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker")
        sandbox = await mgr.get_or_create_sandbox(config, "exec-1")

        # Default is 1h, so 30m ago is safe
        sandbox._last_activity_at = time.monotonic() - 1800

        await mgr._sweep_idle_sandboxes()
        assert sandbox.destroyed is False

    @pytest.mark.asyncio
    async def test_sweep_removes_session_sandbox_from_maps(self):
        """Session sandbox destroyed by sweep is removed from session map."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session", idle_destroy_timeout="1m")
        sandbox = await mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1")

        sandbox._last_activity_at = time.monotonic() - 120

        await mgr._sweep_idle_sandboxes()
        assert "sess-1" not in mgr._session_sandboxes


# ── Session creation lock tests ──────────────────────────────────────────


class TestSandboxManagerSessionLocking:
    """Tests for session sandbox creation serialization."""

    @pytest.mark.asyncio
    async def test_concurrent_session_creation_returns_same_sandbox(self):
        """Concurrent calls for the same session return the same sandbox."""
        mgr = SandboxManager("worker-1", "project-1")
        config = SandboxToolsConfig(env="docker", scope="session")

        # Launch two concurrent creation calls
        results = await asyncio.gather(
            mgr.get_or_create_sandbox(config, "exec-1", session_id="sess-1"),
            mgr.get_or_create_sandbox(config, "exec-2", session_id="sess-1"),
        )

        # Both should get the same sandbox
        assert results[0] is results[1]
        # Both executions should be attached
        assert "exec-1" in results[0].active_execution_ids
        assert "exec-2" in results[0].active_execution_ids
