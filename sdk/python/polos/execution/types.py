"""Shared types for the execution framework.

Defines interfaces for execution environments, command results,
file operations, and configuration.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# -- Input/output types -------------------------------------------------------


class ExecOptions(BaseModel):
    """Options for command execution."""

    cwd: str | None = Field(default=None, description="Working directory for the command")
    env: dict[str, str] | None = Field(default=None, description="Environment variables to set")
    timeout: int | None = Field(default=None, description="Timeout in seconds (default: 300)")
    stdin: str | None = Field(default=None, description="Data to pipe to stdin")


class ExecResult(BaseModel):
    """Result of a command execution."""

    exit_code: int = Field(description="Process exit code (0 = success)")
    stdout: str = Field(description="Standard output")
    stderr: str = Field(description="Standard error")
    duration_ms: int = Field(description="Execution duration in milliseconds")
    truncated: bool = Field(description="Whether output was truncated due to size limits")


class GlobOptions(BaseModel):
    """Options for glob file search."""

    cwd: str | None = Field(default=None, description="Working directory for the search")
    ignore: list[str] | None = Field(default=None, description="Glob patterns to exclude")


class GrepOptions(BaseModel):
    """Options for grep content search."""

    cwd: str | None = Field(default=None, description="Working directory for the search")
    include: list[str] | None = Field(
        default=None, description='File glob patterns to include (e.g., "*.ts")'
    )
    max_results: int | None = Field(default=None, description="Maximum number of matches to return")
    context_lines: int | None = Field(
        default=None, description="Number of context lines around each match"
    )


class GrepMatch(BaseModel):
    """A single grep match result."""

    path: str = Field(description="File path (relative to search root)")
    line: int = Field(description="Line number of the match")
    text: str = Field(description="The matching line text")
    context: str | None = Field(default=None, description="Context lines around the match")


class EnvironmentInfo(BaseModel):
    """Metadata about an execution environment."""

    type: Literal["local", "docker", "e2b"] = Field(description="Environment type")
    cwd: str = Field(description="Current working directory")
    sandbox_id: str | None = Field(
        default=None,
        description="Sandbox/container identifier (container ID for Docker, sandbox ID for E2B)",
    )
    os: str | None = Field(default=None, description="Operating system info")


# -- Configuration types -------------------------------------------------------


class DockerEnvironmentConfig(BaseModel):
    """Configuration for a Docker execution environment."""

    image: str = Field(description='Docker image to use (e.g., "node:20-slim")')
    workspace_dir: str | None = Field(
        default=None,
        description="Host directory to mount as workspace (auto-managed when omitted)",
    )
    container_workdir: str | None = Field(
        default=None, description='Working directory inside the container (default: "/workspace")'
    )
    env: dict[str, str] | None = Field(
        default=None, description="Environment variables to set in the container"
    )
    memory: str | None = Field(default=None, description='Memory limit (e.g., "512m", "2g")')
    cpus: str | None = Field(default=None, description='CPU limit (e.g., "1", "0.5")')
    network: str | None = Field(default=None, description='Network mode (default: "none")')
    setup_command: str | None = Field(
        default=None,
        description='Command to run after container creation (e.g., "npm install")',
    )


class E2BEnvironmentConfig(BaseModel):
    """Configuration for an E2B execution environment."""

    template: str | None = Field(default=None, description='E2B template name (default: "base")')
    api_key: str | None = Field(
        default=None, description="E2B API key (defaults to E2B_API_KEY env var)"
    )
    timeout: int | None = Field(
        default=None, description="Sandbox timeout in seconds (default: 3600)"
    )
    cwd: str | None = Field(default=None, description="Working directory inside the sandbox")
    env: dict[str, str] | None = Field(default=None, description="Environment variables")
    setup_command: str | None = Field(
        default=None, description="Setup command to run after sandbox creation"
    )


class LocalEnvironmentConfig(BaseModel):
    """Configuration for a local execution environment."""

    cwd: str | None = Field(
        default=None, description="Working directory (default: auto-provisioned workspace)"
    )
    path_restriction: str | Literal[False] | None = Field(
        default=None,
        description=(
            "Restrict file operations to this directory. "
            "Defaults to cwd when running inside a managed sandbox. "
            "Set to False to explicitly disable path restriction."
        ),
    )


class ExecToolConfig(BaseModel):
    """Configuration for the exec tool's security and behavior."""

    security: Literal["allow-always", "allowlist", "approval-always"] | None = Field(
        default=None,
        description="Security mode: allow-always (default), allowlist, or always require approval",
    )
    allowlist: list[str] | None = Field(
        default=None, description="Allowed command patterns (for allowlist mode)"
    )
    timeout: int | None = Field(
        default=None, description="Default command timeout in seconds (default: 300)"
    )
    max_output_chars: int | None = Field(
        default=None,
        description="Maximum output characters before truncation (default: 100000)",
    )


SandboxScope = Literal["execution", "session"]


class SandboxToolsConfig(BaseModel):
    """Configuration for the sandbox_tools() factory."""

    env: Literal["local", "docker", "e2b"] | None = Field(
        default=None, description='Environment type (default: "docker")'
    )
    scope: SandboxScope | None = Field(
        default=None,
        description='Sandbox lifecycle scope (default: "execution"). '
        '"session" reuses the sandbox across executions sharing the same session_id.',
    )
    id: str | None = Field(
        default=None, description="Custom sandbox ID (auto-generated if not provided)"
    )
    idle_destroy_timeout: str | None = Field(
        default=None,
        description='Idle timeout before session-scoped sandbox is destroyed (default: "1h"). '
        'Supports "30m", "1h", "3d" format.',
    )
    cwd: str | None = Field(default=None, description="Working directory override")
    tools: list[Literal["exec", "read", "write", "edit", "glob", "grep"]] | None = Field(
        default=None, description="Subset of tools to include (default: all)"
    )
    docker: DockerEnvironmentConfig | None = Field(
        default=None, description="Docker environment configuration"
    )
    e2b: E2BEnvironmentConfig | None = Field(
        default=None, description="E2B environment configuration"
    )
    local: LocalEnvironmentConfig | None = Field(
        default=None, description="Local environment configuration"
    )
    exec: ExecToolConfig | None = Field(default=None, description="Exec tool configuration")
    file_approval: Literal["always", "none"] | None = Field(
        default=None,
        description="Approval mode for file-mutating tools (write, edit). "
        "Defaults to 'always' for local env.",
    )
