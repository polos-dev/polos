"""Local execution environment.

Runs commands and accesses files directly on the host machine.
Optionally restricts file operations to a specified directory
and blocks symlink traversal when path restriction is active.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Literal

from .environment import ExecutionEnvironment
from .output import is_binary, parse_grep_output, strip_ansi, truncate_output
from .types import (
    EnvironmentInfo,
    ExecOptions,
    ExecResult,
    GlobOptions,
    GrepMatch,
    GrepOptions,
    LocalEnvironmentConfig,
)

# Default command timeout in seconds
DEFAULT_TIMEOUT_SECONDS = 300

# Default maximum output characters
DEFAULT_MAX_OUTPUT_CHARS = 100_000


async def _spawn_local(
    command: str,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
    timeout: int | None = None,
    stdin: str | None = None,
) -> tuple[int, str, str]:
    """Execute a shell command via asyncio subprocess.

    Args:
        command: Shell command to execute.
        cwd: Working directory.
        env: Additional environment variables.
        timeout: Timeout in seconds.
        stdin: Optional data to pipe to stdin.

    Returns:
        Tuple of (exit_code, stdout, stderr).
    """
    timeout_seconds = timeout if timeout is not None else DEFAULT_TIMEOUT_SECONDS

    # Merge environment variables
    proc_env = None
    if env:
        proc_env = {**os.environ, **env}

    proc = await asyncio.create_subprocess_exec(
        "sh",
        "-c",
        command,
        cwd=cwd,
        env=proc_env,
        stdin=asyncio.subprocess.PIPE,
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


class LocalEnvironment(ExecutionEnvironment):
    """Local execution environment.

    Executes commands and file operations directly on the host.
    When ``path_restriction`` is configured, file operations are restricted
    to the specified directory and symlink traversal is blocked.
    """

    @property
    def type(self) -> Literal["local"]:
        return "local"

    def __init__(
        self,
        config: LocalEnvironmentConfig | None = None,
        max_output_chars: int | None = None,
    ) -> None:
        self._config = config or LocalEnvironmentConfig()
        self._cwd = os.path.abspath(self._config.cwd or os.getcwd())
        self._max_output_chars = max_output_chars or DEFAULT_MAX_OUTPUT_CHARS

    async def initialize(self, labels: dict[str, str] | None = None) -> None:
        # Labels are ignored for local environments (no container to label)
        # Validate that the working directory exists
        if not os.path.exists(self._cwd):
            raise RuntimeError(f"Working directory does not exist: {self._cwd}")
        if not os.path.isdir(self._cwd):
            raise RuntimeError(f"Working directory is not a directory: {self._cwd}")

    async def exec(self, command: str, opts: ExecOptions | None = None) -> ExecResult:
        cwd = self._resolve_path(opts.cwd) if (opts and opts.cwd) else self._cwd
        timeout = (opts.timeout if opts and opts.timeout else None) or DEFAULT_TIMEOUT_SECONDS
        start = time.monotonic()

        exit_code, stdout, stderr = await _spawn_local(
            command,
            cwd=cwd,
            env=opts.env if opts else None,
            timeout=timeout,
            stdin=opts.stdin if opts else None,
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
        resolved = self._resolve_path(file_path)
        # Path restriction for reads is handled at the tool layer (approval gate).
        # Symlink traversal is still blocked at the environment level.
        await self._assert_not_symlink(resolved)

        with open(resolved, "rb") as f:
            data = f.read()
        if is_binary(data):
            raise ValueError(f"Cannot read binary file: {file_path}")
        return data.decode("utf-8")

    async def write_file(self, file_path: str, content: str) -> None:
        resolved = self._resolve_path(file_path)
        self._assert_path_safe(resolved)

        parent_dir = os.path.dirname(resolved)
        os.makedirs(parent_dir, exist_ok=True)
        with open(resolved, "w", encoding="utf-8") as f:
            f.write(content)

    async def file_exists(self, file_path: str) -> bool:
        resolved = self._resolve_path(file_path)
        return os.path.exists(resolved)

    async def glob(self, pattern: str, opts: GlobOptions | None = None) -> list[str]:
        cwd = self._resolve_path(opts.cwd) if (opts and opts.cwd) else self._cwd

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
        cwd = self._resolve_path(opts.cwd) if (opts and opts.cwd) else self._cwd
        max_results = (opts.max_results if opts and opts.max_results else None) or 100

        command = "grep -rn"

        if opts and opts.context_lines is not None:
            command += f" -C {opts.context_lines}"

        if opts and opts.include:
            for inc in opts.include:
                command += f" --include='{inc}'"

        # Escape single quotes in pattern, use -- to separate pattern from paths
        escaped_pattern = pattern.replace("'", "'\\''")
        command += f" -- '{escaped_pattern}' {cwd}"
        command += f" 2>/dev/null | head -{max_results}"

        result = await self.exec(command)
        return parse_grep_output(result.stdout)

    async def destroy(self) -> None:
        # No-op -- local environment has no resources to clean up
        pass

    def get_cwd(self) -> str:
        return self._cwd

    def get_info(self) -> EnvironmentInfo:
        return EnvironmentInfo(
            type="local",
            cwd=self._cwd,
        )

    def _resolve_path(self, p: str) -> str:
        """Resolve a path relative to the working directory."""
        return os.path.abspath(os.path.join(self._cwd, p))

    def _assert_path_safe(self, resolved_path: str) -> None:
        """Assert that a resolved path stays within the path restriction.

        No-op when path restriction is not configured.
        """
        if not self._config.path_restriction:
            return

        restriction = os.path.abspath(self._config.path_restriction)
        if resolved_path != restriction and not resolved_path.startswith(restriction + os.sep):
            raise ValueError(
                f'Path traversal detected: "{resolved_path}" is outside of "{restriction}"'
            )

    async def _assert_not_symlink(self, resolved_path: str) -> None:
        """Assert that a path is not a symbolic link.

        Only enforced when path restriction is configured.
        """
        if not self._config.path_restriction:
            return

        try:
            if os.path.islink(resolved_path):
                raise ValueError(
                    f'Symbolic link detected: "{resolved_path}". '
                    "Symlinks are blocked when path_restriction is set."
                )
        except OSError:
            # File doesn't exist -- that's fine, let read_file handle the error
            pass
