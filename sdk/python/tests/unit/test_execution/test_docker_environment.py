"""Tests for the Docker execution environment."""

import pytest

from polos.execution.docker import DockerEnvironment
from polos.execution.types import DockerEnvironmentConfig


class TestDockerEnvironmentPathTranslation:
    """Tests for path translation between container and host."""

    def _make_env(self, **overrides):
        config = DockerEnvironmentConfig(
            image="node:20-slim",
            workspace_dir="/tmp/test-workspace",
            **overrides,
        )
        return DockerEnvironment(config)

    def test_to_host_path_translates_container_paths(self):
        """Container paths are translated to host paths."""
        env = self._make_env()
        host_path = env.to_host_path("/workspace/src/main.ts")
        assert host_path == "/tmp/test-workspace/src/main.ts"

    def test_to_host_path_handles_root_workspace_path(self):
        """The workspace root itself is translated."""
        env = self._make_env()
        host_path = env.to_host_path("/workspace")
        assert host_path == "/tmp/test-workspace"

    def test_to_host_path_handles_relative_path_within_workspace(self):
        """Relative segments within the workspace are resolved."""
        env = self._make_env()
        host_path = env.to_host_path("/workspace/./src/../src/main.ts")
        assert host_path == "/tmp/test-workspace/src/main.ts"

    def test_to_host_path_rejects_path_traversal(self):
        """Paths escaping the workspace via .. are rejected."""
        env = self._make_env()
        with pytest.raises(ValueError, match="Path traversal detected"):
            env.to_host_path("/workspace/../etc/passwd")

    def test_to_host_path_rejects_absolute_paths_outside_workspace(self):
        """Absolute paths outside the workspace are rejected."""
        env = self._make_env()
        with pytest.raises(ValueError, match="Path traversal detected"):
            env.to_host_path("/etc/passwd")

    def test_to_container_path_translates_host_paths(self):
        """Host paths are translated to container paths."""
        env = self._make_env()
        container_path = env.to_container_path("/tmp/test-workspace/src/main.ts")
        assert container_path == "/workspace/src/main.ts"

    def test_to_container_path_rejects_paths_outside_workspace(self):
        """Host paths outside the workspace are rejected."""
        env = self._make_env()
        with pytest.raises(ValueError, match="Path outside workspace"):
            env.to_container_path("/other/path/file.ts")

    def test_respects_custom_container_workdir(self):
        """Custom containerWorkdir is respected in path translation."""
        env = self._make_env(container_workdir="/app")
        host_path = env.to_host_path("/app/src/main.ts")
        assert host_path == "/tmp/test-workspace/src/main.ts"

    def test_custom_container_workdir_rejects_traversal(self):
        """Traversal out of custom workdir is blocked."""
        env = self._make_env(container_workdir="/app")
        with pytest.raises(ValueError, match="Path traversal detected"):
            env.to_host_path("/app/../etc/passwd")


class TestDockerEnvironmentGetCwd:
    """Tests for getCwd."""

    def test_returns_default_container_workdir(self):
        """Default workdir is /workspace."""
        config = DockerEnvironmentConfig(image="node:20-slim", workspace_dir="/tmp/ws")
        env = DockerEnvironment(config)
        assert env.get_cwd() == "/workspace"

    def test_returns_custom_workdir(self):
        """Custom workdir is returned."""
        config = DockerEnvironmentConfig(
            image="node:20-slim", workspace_dir="/tmp/ws", container_workdir="/app"
        )
        env = DockerEnvironment(config)
        assert env.get_cwd() == "/app"


class TestDockerEnvironmentGetInfo:
    """Tests for getInfo."""

    def test_returns_environment_info_before_init(self):
        """Info is available even before initialize()."""
        config = DockerEnvironmentConfig(image="node:20-slim", workspace_dir="/tmp/ws")
        env = DockerEnvironment(config)
        info = env.get_info()
        assert info.type == "docker"
        assert info.cwd == "/workspace"
        assert info.sandbox_id is None

    def test_returns_custom_workdir_in_info(self):
        """Custom workdir appears in info."""
        config = DockerEnvironmentConfig(
            image="node:20-slim", workspace_dir="/tmp/ws", container_workdir="/app"
        )
        env = DockerEnvironment(config)
        info = env.get_info()
        assert info.cwd == "/app"


class TestDockerEnvironmentType:
    """Tests for the type property."""

    def test_has_type_docker(self):
        """Type is 'docker'."""
        config = DockerEnvironmentConfig(image="node:20-slim", workspace_dir="/tmp/ws")
        env = DockerEnvironment(config)
        assert env.type == "docker"


class TestDockerEnvironmentExec:
    """Tests for exec without initialization."""

    @pytest.mark.asyncio
    async def test_throws_if_not_initialized(self):
        """Exec without initialize() raises."""
        config = DockerEnvironmentConfig(image="node:20-slim", workspace_dir="/tmp/ws")
        env = DockerEnvironment(config)
        with pytest.raises(RuntimeError, match="not initialized"):
            await env.exec("echo hello")


class TestDockerEnvironmentDestroy:
    """Tests for destroy."""

    @pytest.mark.asyncio
    async def test_is_safe_to_call_without_initialization(self):
        """Destroy without initialization does not raise."""
        config = DockerEnvironmentConfig(image="node:20-slim", workspace_dir="/tmp/ws")
        env = DockerEnvironment(config)
        await env.destroy()
