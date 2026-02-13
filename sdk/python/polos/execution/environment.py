"""Abstract interface for execution environments.

All sandbox tools operate against this interface. Implementations
include Docker, E2B, and Local environments.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal

from .types import EnvironmentInfo, ExecOptions, ExecResult, GlobOptions, GrepMatch, GrepOptions


class ExecutionEnvironment(ABC):
    """Abstract interface for an execution environment (Docker, E2B, Local).

    All sandbox tools operate against this interface.
    """

    @property
    @abstractmethod
    def type(self) -> Literal["local", "docker", "e2b"]:
        """Environment type discriminator."""
        ...

    @abstractmethod
    async def exec(self, command: str, opts: ExecOptions | None = None) -> ExecResult:
        """Execute a shell command in the environment."""
        ...

    @abstractmethod
    async def read_file(self, path: str) -> str:
        """Read a file's contents as UTF-8 text."""
        ...

    @abstractmethod
    async def write_file(self, path: str, content: str) -> None:
        """Write content to a file, creating parent directories as needed."""
        ...

    @abstractmethod
    async def file_exists(self, path: str) -> bool:
        """Check whether a file exists."""
        ...

    @abstractmethod
    async def glob(self, pattern: str, opts: GlobOptions | None = None) -> list[str]:
        """Find files matching a glob pattern."""
        ...

    @abstractmethod
    async def grep(self, pattern: str, opts: GrepOptions | None = None) -> list[GrepMatch]:
        """Search file contents for a pattern."""
        ...

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the environment (create container, connect to sandbox, etc.)."""
        ...

    @abstractmethod
    async def destroy(self) -> None:
        """Tear down the environment (remove container, kill sandbox, etc.)."""
        ...

    @abstractmethod
    def get_cwd(self) -> str:
        """Get the current working directory inside the environment."""
        ...

    @abstractmethod
    def get_info(self) -> EnvironmentInfo:
        """Get environment metadata."""
        ...
