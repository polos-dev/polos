"""Agent with session-scoped sandbox tools.

The key difference from example 18 (sandbox-tools) is ``scope='session'``.
This tells the SandboxManager to reuse the same Docker container across
multiple invocations that share the same sessionId. Files created in one
invocation are visible in subsequent ones.
"""

from polos import (
    Agent,
    max_steps,
    MaxStepsConfig,
    sandbox_tools,
    SandboxToolsConfig,
    DockerEnvironmentConfig,
)

# Session-scoped sandbox tools -- the container persists across agent runs
# that share the same sessionId. Workspace files survive between invocations.
tools = sandbox_tools(
    SandboxToolsConfig(
        scope="session",
        env="docker",
        docker=DockerEnvironmentConfig(
            image="node:20-slim",
        ),
    )
)

coding_agent = Agent(
    id="session_coding_agent",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt=(
        "You are a coding agent with access to a persistent sandbox environment. "
        "You can create files, edit code, run shell commands, and search the codebase. "
        "The workspace is at /workspace inside the container. "
        "Files from previous turns in this session are still present -- check what "
        "already exists before creating new files. "
        "Use the tools to complete the task, then summarize what you did and show the output. "
        "Always verify your work by running the code after writing it."
    ),
    tools=tools,
    stop_conditions=[max_steps(MaxStepsConfig(count=50))],
)
