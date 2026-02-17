"""Docker execution environment.

Runs commands inside a Docker container and accesses files via bind mount
for optimal performance. The container runs ``sleep infinity`` and commands
are executed via ``docker exec``.
"""

from __future__ import annotations

import asyncio
import os
import posixpath
import time
import uuid
from typing import Literal

from .environment import ExecutionEnvironment
from .output import is_binary, parse_grep_output, strip_ansi, truncate_output
from .types import (
    DockerEnvironmentConfig,
    EnvironmentInfo,
    ExecOptions,
    ExecResult,
    GlobOptions,
    GrepMatch,
    GrepOptions,
)

# Default container working directory
DEFAULT_CONTAINER_WORKDIR = "/workspace"

# Default command timeout in seconds
DEFAULT_TIMEOUT_SECONDS = 300

# Default maximum output characters
DEFAULT_MAX_OUTPUT_CHARS = 100_000


async def _spawn_command(
    command: str,
    args: list[str],
    timeout: int | None = None,
    stdin: str | None = None,
) -> tuple[int, str, str]:
    """Execute a command via asyncio subprocess and capture output.

    Args:
        command: The executable to run.
        args: Arguments for the executable.
        timeout: Timeout in seconds.
        stdin: Optional data to pipe to stdin.

    Returns:
        Tuple of (exit_code, stdout, stderr).
    """
    timeout_seconds = timeout if timeout is not None else DEFAULT_TIMEOUT_SECONDS

    proc = await asyncio.create_subprocess_exec(
        command,
        *args,
        stdin=asyncio.subprocess.PIPE if stdin else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(input=stdin.encode() if stdin else None),
            timeout=timeout_seconds,
        )
        exit_code = proc.returncode if proc.returncode is not None else 1
        return (
            exit_code,
            stdout_bytes.decode("utf-8", errors="replace"),
            stderr_bytes.decode("utf-8", errors="replace"),
        )
    except asyncio.TimeoutError:
        proc.kill()
        # Collect any partial output
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=5)
        except (asyncio.TimeoutError, Exception):
            stdout_bytes = b""
            stderr_bytes = b""
        stdout = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
        stderr = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""
        return 137, stdout, stderr + "\n[Process killed: timeout exceeded]"


class DockerEnvironment(ExecutionEnvironment):
    """Docker-based execution environment.

    Creates a persistent Docker container with a bind-mounted workspace.
    Commands run inside the container via ``docker exec``, while file
    operations use the host filesystem through the bind mount for speed.
    """

    @property
    def type(self) -> Literal["docker"]:
        return "docker"

    def __init__(
        self,
        config: DockerEnvironmentConfig,
        max_output_chars: int | None = None,
    ) -> None:
        self._config = config
        self._container_workdir = config.container_workdir or DEFAULT_CONTAINER_WORKDIR
        self._container_name = f"polos-sandbox-{uuid.uuid4().hex[:8]}"
        self._container_id: str | None = None
        self._max_output_chars = max_output_chars or DEFAULT_MAX_OUTPUT_CHARS

    async def initialize(self) -> None:
        args = [
            "run",
            "-d",
            "--name",
            self._container_name,
            "-v",
            f"{self._config.workspace_dir}:{self._container_workdir}:rw",
            "-w",
            self._container_workdir,
        ]

        if self._config.memory:
            args.extend(["--memory", self._config.memory])
        if self._config.cpus:
            args.extend(["--cpus", self._config.cpus])
        args.extend(["--network", self._config.network or "none"])

        if self._config.env:
            for key, value in self._config.env.items():
                args.extend(["-e", f"{key}={value}"])

        args.extend([self._config.image, "sleep", "infinity"])

        exit_code, stdout, stderr = await _spawn_command("docker", args, timeout=60)
        if exit_code != 0:
            raise RuntimeError(f"Failed to create Docker container: {stderr.strip()}")
        self._container_id = stdout.strip()[:12]

        # Run setup command if provided
        if self._config.setup_command:
            setup_result = await self.exec(self._config.setup_command)
            if setup_result.exit_code != 0:
                raise RuntimeError(
                    f"Setup command failed (exit {setup_result.exit_code}): "
                    f"{setup_result.stderr.strip()}"
                )

    async def exec(self, command: str, opts: ExecOptions | None = None) -> ExecResult:
        self._assert_initialized()

        # Only use -i (interactive/keep-stdin-open) when stdin data is provided.
        # Without stdin data, -i can cause docker exec to hang waiting for EOF.
        stdin = opts.stdin if opts else None
        args = ["exec", "-i"] if stdin else ["exec"]

        # Set working directory
        cwd = (opts.cwd if opts and opts.cwd else None) or self._container_workdir
        args.extend(["-w", cwd])

        # Set environment variables
        if opts and opts.env:
            for key, value in opts.env.items():
                args.extend(["-e", f"{key}={value}"])

        args.extend([self._container_name, "sh", "-c", command])

        timeout = (opts.timeout if opts and opts.timeout else None) or DEFAULT_TIMEOUT_SECONDS
        start = time.monotonic()

        exit_code, stdout, stderr = await _spawn_command(
            "docker",
            args,
            timeout=timeout,
            stdin=stdin,
        )

        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_clean, stdout_truncated = truncate_output(strip_ansi(stdout), self._max_output_chars)
        stderr_clean, _ = truncate_output(strip_ansi(stderr), self._max_output_chars)

        return ExecResult(
            exit_code=exit_code,
            stdout=stdout_clean,
            stderr=stderr_clean,
            duration_ms=duration_ms,
            truncated=stdout_truncated,
        )

    async def read_file(self, file_path: str) -> str:
        host_path = self.to_host_path(file_path)
        with open(host_path, "rb") as f:
            data = f.read()
        if is_binary(data):
            raise ValueError(f"Cannot read binary file: {file_path}")
        return data.decode("utf-8")

    async def write_file(self, file_path: str, content: str) -> None:
        host_path = self.to_host_path(file_path)
        os.makedirs(os.path.dirname(host_path), exist_ok=True)
        with open(host_path, "w", encoding="utf-8") as f:
            f.write(content)

    async def file_exists(self, file_path: str) -> bool:
        host_path = self.to_host_path(file_path)
        return os.path.exists(host_path)

    async def glob(self, pattern: str, opts: GlobOptions | None = None) -> list[str]:
        cwd = (opts.cwd if opts and opts.cwd else None) or self._container_workdir
        command = f"find {cwd} -type f -name '{pattern}'"

        if opts and opts.ignore:
            for ignore in opts.ignore:
                command += f" ! -path '{ignore}'"

        command += " 2>/dev/null | sort | head -1000"

        result = await self.exec(command)
        if not result.stdout.strip():
            return []

        return [line for line in result.stdout.strip().split("\n") if line]

    async def grep(self, pattern: str, opts: GrepOptions | None = None) -> list[GrepMatch]:
        cwd = (opts.cwd if opts and opts.cwd else None) or self._container_workdir
        max_results = (opts.max_results if opts and opts.max_results else None) or 100

        command = "grep -rn"

        if opts and opts.context_lines is not None:
            command += f" -C {opts.context_lines}"

        if opts and opts.include:
            for inc in opts.include:
                command += f" --include='{inc}'"

        # Use -- to separate pattern from paths, escape single quotes in pattern
        escaped_pattern = pattern.replace("'", "'\\''")
        command += f" -- '{escaped_pattern}' {cwd}"
        command += f" 2>/dev/null | head -{max_results}"

        result = await self.exec(command)
        return parse_grep_output(result.stdout)

    async def destroy(self) -> None:
        if not self._container_id:
            return
        try:
            await _spawn_command("docker", ["rm", "-f", self._container_name], timeout=30)
        finally:
            self._container_id = None

    def get_cwd(self) -> str:
        return self._container_workdir

    def get_info(self) -> EnvironmentInfo:
        return EnvironmentInfo(
            type="docker",
            cwd=self._container_workdir,
            sandbox_id=self._container_id,
        )

    def to_host_path(self, container_path: str) -> str:
        """Translate a container path to the corresponding host filesystem path.

        Validates the path stays within the workspace to prevent traversal.

        Args:
            container_path: Path inside the container.

        Returns:
            Corresponding host filesystem path.

        Raises:
            ValueError: If path traversal is detected.
        """
        # Resolve relative to container workdir
        resolved = posixpath.normpath(posixpath.join(self._container_workdir, container_path))

        # Ensure the resolved path is within the container workdir
        if not resolved.startswith(self._container_workdir):
            raise ValueError(
                f'Path traversal detected: "{container_path}" resolves outside workspace'
            )

        # Translate to host path
        relative = posixpath.relpath(resolved, self._container_workdir)
        return os.path.normpath(os.path.join(self._config.workspace_dir, relative))

    def to_container_path(self, host_path: str) -> str:
        """Translate a host filesystem path to the corresponding container path.

        Args:
            host_path: Path on the host filesystem.

        Returns:
            Corresponding container path.

        Raises:
            ValueError: If the path is outside the workspace.
        """
        resolved = os.path.abspath(host_path)
        workspace = os.path.abspath(self._config.workspace_dir)

        if not resolved.startswith(workspace):
            raise ValueError(
                f'Path outside workspace: "{host_path}" is not within '
                f'"{self._config.workspace_dir}"'
            )

        relative = os.path.relpath(resolved, workspace)
        return posixpath.join(self._container_workdir, relative)

    def _assert_initialized(self) -> None:
        if not self._container_id:
            raise RuntimeError("Docker environment not initialized. Call initialize() first.")
