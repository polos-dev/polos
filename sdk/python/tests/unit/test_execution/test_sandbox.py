"""Tests for the ManagedSandbox class."""

import asyncio
import os
import time
from unittest.mock import AsyncMock, patch

import pytest

from polos.execution.sandbox import (
    DEFAULT_WORKSPACES_DIR,
    HEALTH_CHECK_DEBOUNCE_S,
    WORKSPACES_DIR_ENV,
    ManagedSandbox,
    Sandbox,
)
from polos.execution.types import (
    LocalEnvironmentConfig,
    SandboxToolsConfig,
)


class TestManagedSandboxInit:
    """Tests for ManagedSandbox construction."""

    def test_generates_id_when_not_provided(self):
        """Auto-generates a sandbox ID when config.id is None."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.id.startswith("sandbox-")
        assert len(sandbox.id) == len("sandbox-") + 8

    def test_uses_custom_id_when_provided(self):
        """Uses the config.id when provided."""
        config = SandboxToolsConfig(env="docker", id="my-sandbox")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.id == "my-sandbox"

    def test_defaults_scope_to_execution(self):
        """Scope defaults to 'execution' when not specified."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.scope == "execution"

    def test_respects_session_scope(self):
        """Session scope is stored when specified."""
        config = SandboxToolsConfig(env="docker", scope="session")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.scope == "session"

    def test_stores_worker_and_project_ids(self):
        """Worker and project IDs are stored."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.worker_id == "worker-1"

    def test_stores_session_id(self):
        """Session ID is stored when provided."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1", session_id="session-1")
        assert sandbox.session_id == "session-1"

    def test_session_id_defaults_to_none(self):
        """Session ID defaults to None."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.session_id is None

    def test_starts_not_initialized(self):
        """Sandbox starts in non-initialized state."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.initialized is False

    def test_starts_not_destroyed(self):
        """Sandbox starts in non-destroyed state."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.destroyed is False

    def test_starts_with_empty_execution_ids(self):
        """Active execution IDs start empty."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.active_execution_ids == frozenset()

    def test_config_is_accessible(self):
        """Config is stored and accessible."""
        config = SandboxToolsConfig(env="docker", scope="session")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert sandbox.config is config


class TestManagedSandboxExecutionTracking:
    """Tests for attach/detach execution."""

    def test_attach_execution_adds_id(self):
        """Attaching an execution adds it to the set."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        sandbox.attach_execution("exec-1")
        assert "exec-1" in sandbox.active_execution_ids

    def test_attach_multiple_executions(self):
        """Multiple executions can be attached."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        sandbox.attach_execution("exec-1")
        sandbox.attach_execution("exec-2")
        assert sandbox.active_execution_ids == frozenset({"exec-1", "exec-2"})

    def test_attach_duplicate_is_idempotent(self):
        """Attaching the same execution twice is a no-op."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        sandbox.attach_execution("exec-1")
        sandbox.attach_execution("exec-1")
        assert len(sandbox.active_execution_ids) == 1

    def test_detach_execution_removes_id(self):
        """Detaching an execution removes it from the set."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        sandbox.attach_execution("exec-1")
        sandbox.detach_execution("exec-1")
        assert "exec-1" not in sandbox.active_execution_ids

    def test_detach_nonexistent_is_safe(self):
        """Detaching an execution that was never attached is a no-op."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        sandbox.detach_execution("nonexistent")
        assert sandbox.active_execution_ids == frozenset()


class TestManagedSandboxSetWorkerId:
    """Tests for set_worker_id."""

    def test_updates_worker_id(self):
        """Worker ID can be updated after construction."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "old-worker", "project-1")
        assert sandbox.worker_id == "old-worker"

        sandbox.set_worker_id("new-worker")
        assert sandbox.worker_id == "new-worker"


class TestManagedSandboxDestroy:
    """Tests for destroy."""

    @pytest.mark.asyncio
    async def test_destroy_sets_destroyed_flag(self):
        """Destroy sets the destroyed flag."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        await sandbox.destroy()
        assert sandbox.destroyed is True

    @pytest.mark.asyncio
    async def test_destroy_is_idempotent(self):
        """Calling destroy twice does not raise."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        await sandbox.destroy()
        await sandbox.destroy()
        assert sandbox.destroyed is True

    @pytest.mark.asyncio
    async def test_destroy_calls_env_destroy(self):
        """Destroy calls destroy on the underlying environment."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        sandbox._env = mock_env

        await sandbox.destroy()
        mock_env.destroy.assert_awaited_once()
        assert sandbox._env is None

    @pytest.mark.asyncio
    async def test_destroy_handles_env_destroy_failure(self):
        """Destroy swallows errors from env.destroy()."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.destroy.side_effect = RuntimeError("container gone")
        sandbox._env = mock_env

        await sandbox.destroy()  # Should not raise
        assert sandbox.destroyed is True
        assert sandbox._env is None


class TestManagedSandboxRecreate:
    """Tests for recreate."""

    @pytest.mark.asyncio
    async def test_recreate_clears_state(self):
        """Recreate clears env and resets destroyed flag."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        sandbox._destroyed = True
        sandbox._env = AsyncMock()

        await sandbox.recreate()

        assert sandbox._env is None
        assert sandbox._env_future is None
        assert sandbox.destroyed is False
        assert sandbox._last_health_check_at == 0

    @pytest.mark.asyncio
    async def test_recreate_best_effort_destroys_old_env(self):
        """Recreate calls destroy on old env, swallows errors."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.destroy.side_effect = RuntimeError("already dead")
        sandbox._env = mock_env

        await sandbox.recreate()  # Should not raise
        mock_env.destroy.assert_awaited_once()
        assert sandbox._env is None


class TestManagedSandboxGetEnvironment:
    """Tests for get_environment."""

    @pytest.mark.asyncio
    async def test_raises_if_destroyed(self):
        """get_environment raises if sandbox is destroyed."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        await sandbox.destroy()

        with pytest.raises(RuntimeError, match="has been destroyed"):
            await sandbox.get_environment()

    @pytest.mark.asyncio
    async def test_returns_existing_env(self):
        """get_environment returns existing env without reinitializing."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.type = "local"  # avoid health check triggering
        sandbox._env = mock_env

        result = await sandbox.get_environment()
        assert result is mock_env

    @pytest.mark.asyncio
    async def test_updates_last_activity_at(self):
        """get_environment updates last_activity_at."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.type = "local"
        sandbox._env = mock_env

        before = sandbox.last_activity_at
        await asyncio.sleep(0.01)
        await sandbox.get_environment()
        assert sandbox.last_activity_at > before

    @pytest.mark.asyncio
    async def test_initializes_local_env(self):
        """get_environment initializes a local environment."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            config = SandboxToolsConfig(
                env="local",
                local=LocalEnvironmentConfig(cwd=tmp_dir),
            )
            sandbox = ManagedSandbox(config, "worker-1", "project-1")

            env = await sandbox.get_environment()
            assert env.type == "local"
            assert sandbox.initialized is True

            await sandbox.destroy()


class TestManagedSandboxWorkspaceDir:
    """Tests for workspace directory computation."""

    def test_default_workspace_uses_session_id_when_present(self):
        """Workspace leaf directory uses session_id when provided."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "proj-1", session_id="sess-1")
        workspace = sandbox._get_default_workspace_dir()
        assert workspace == os.path.join(DEFAULT_WORKSPACES_DIR, "proj-1", "sess-1")

    def test_default_workspace_uses_sandbox_id_when_no_session(self):
        """Workspace leaf directory uses sandbox id when no session_id."""
        config = SandboxToolsConfig(env="docker", id="my-box")
        sandbox = ManagedSandbox(config, "worker-1", "proj-1")
        workspace = sandbox._get_default_workspace_dir()
        assert workspace == os.path.join(DEFAULT_WORKSPACES_DIR, "proj-1", "my-box")

    def test_respects_env_var_override(self):
        """POLOS_WORKSPACES_DIR env var overrides default base."""
        config = SandboxToolsConfig(env="docker", id="box")
        sandbox = ManagedSandbox(config, "worker-1", "proj-1")

        with patch.dict(os.environ, {WORKSPACES_DIR_ENV: "/custom/ws"}):
            workspace = sandbox._get_default_workspace_dir()

        assert workspace == os.path.join("/custom/ws", "proj-1", "box")


class TestManagedSandboxHealthCheck:
    """Tests for the health check debounce."""

    @pytest.mark.asyncio
    async def test_skips_health_check_for_non_docker(self):
        """Health check is a no-op for non-docker environments."""
        config = SandboxToolsConfig(env="local")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.type = "local"
        sandbox._env = mock_env

        await sandbox._health_check()
        mock_env.exec.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_skips_health_check_within_debounce(self):
        """Health check is skipped if called within debounce window."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.type = "docker"
        sandbox._env = mock_env
        sandbox._last_health_check_at = time.monotonic()  # Just checked

        await sandbox._health_check()
        mock_env.exec.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_runs_health_check_after_debounce(self):
        """Health check runs after debounce window expires."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.type = "docker"
        sandbox._env = mock_env
        sandbox._last_health_check_at = time.monotonic() - HEALTH_CHECK_DEBOUNCE_S - 1

        await sandbox._health_check()
        mock_env.exec.assert_awaited_once_with("true", None)

    @pytest.mark.asyncio
    async def test_health_check_recreates_on_dead_container(self):
        """Health check triggers recreate when container is dead."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.type = "docker"
        mock_env.exec.side_effect = RuntimeError("No such container: abc123")
        sandbox._env = mock_env
        sandbox._last_health_check_at = 0

        # Patch recreate and get_environment to avoid actual init
        sandbox.recreate = AsyncMock()
        sandbox.get_environment = AsyncMock()

        await sandbox._health_check()
        sandbox.recreate.assert_awaited_once()
        sandbox.get_environment.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_health_check_ignores_non_container_errors(self):
        """Health check does not recreate on non-container errors (e.g. timeout)."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")

        mock_env = AsyncMock()
        mock_env.type = "docker"
        mock_env.exec.side_effect = RuntimeError("timeout")
        sandbox._env = mock_env
        sandbox._last_health_check_at = 0

        sandbox.recreate = AsyncMock()

        await sandbox._health_check()
        sandbox.recreate.assert_not_awaited()


class TestManagedSandboxProtocol:
    """Tests that ManagedSandbox satisfies the Sandbox protocol."""

    def test_is_instance_of_sandbox(self):
        """ManagedSandbox is a runtime instance of the Sandbox protocol."""
        config = SandboxToolsConfig(env="docker")
        sandbox = ManagedSandbox(config, "worker-1", "project-1")
        assert isinstance(sandbox, Sandbox)
