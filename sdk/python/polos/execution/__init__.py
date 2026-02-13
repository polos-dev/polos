"""Execution framework -- sandbox tools for AI agents.

Provides tools for running commands, reading/writing files, and searching
codebases inside isolated environments (Docker, E2B, Local).
"""

# Main entry point
# Environment implementations
from .docker import DockerEnvironment
from .environment import ExecutionEnvironment
from .local import LocalEnvironment

# Output utilities
from .output import is_binary, parse_grep_output, strip_ansi, truncate_output
from .sandbox_tools import SandboxToolsResult, sandbox_tools

# Security utilities
from .security import assert_safe_path, evaluate_allowlist, is_within_restriction

# Tool factories
from .tools.edit import create_edit_tool
from .tools.exec import create_exec_tool
from .tools.glob import create_glob_tool
from .tools.grep import create_grep_tool
from .tools.read import create_read_tool
from .tools.write import create_write_tool

# Types
from .types import (
    DockerEnvironmentConfig,
    E2BEnvironmentConfig,
    EnvironmentInfo,
    ExecOptions,
    ExecResult,
    ExecToolConfig,
    GlobOptions,
    GrepMatch,
    GrepOptions,
    LocalEnvironmentConfig,
    SandboxToolsConfig,
)

__all__ = [
    # Main entry point
    "sandbox_tools",
    "SandboxToolsResult",
    # Types
    "ExecutionEnvironment",
    "ExecOptions",
    "ExecResult",
    "GlobOptions",
    "GrepOptions",
    "GrepMatch",
    "EnvironmentInfo",
    "DockerEnvironmentConfig",
    "E2BEnvironmentConfig",
    "LocalEnvironmentConfig",
    "ExecToolConfig",
    "SandboxToolsConfig",
    # Environments
    "DockerEnvironment",
    "LocalEnvironment",
    # Security
    "evaluate_allowlist",
    "assert_safe_path",
    "is_within_restriction",
    # Output
    "truncate_output",
    "is_binary",
    "parse_grep_output",
    "strip_ansi",
    # Tool factories
    "create_exec_tool",
    "create_read_tool",
    "create_write_tool",
    "create_edit_tool",
    "create_glob_tool",
    "create_grep_tool",
]
