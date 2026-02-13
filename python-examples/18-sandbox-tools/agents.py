"""Agent with sandbox tools for executing code inside a Docker container.

The agent gets access to exec, read, write, edit, glob, and grep tools
that all operate inside an isolated Docker container with a bind-mounted
workspace directory.
"""

import os

from polos import (
    Agent,
    max_steps,
    MaxStepsConfig,
    sandbox_tools,
    SandboxToolsConfig,
    DockerEnvironmentConfig,
)

# Workspace directory on the host -- gets mounted into the container at /workspace
workspace_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace")

# Create sandbox tools that run inside a Docker container
tools = sandbox_tools(
    SandboxToolsConfig(
        env="docker",
        docker=DockerEnvironmentConfig(
            image="node:20-slim",
            workspace_dir=workspace_dir,
            # setup_command="npm install",  # optional: run after container creation
            # memory="512m",               # optional: limit container memory
            # network="none",              # default: no network access
        ),
    )
)

# Define an agent that can write and run code in the sandbox
coding_agent = Agent(
    id="coding_agent",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt=(
        "You are a coding agent with access to a sandbox environment. "
        "You can create files, edit code, run shell commands, and search the codebase. "
        "The workspace is at /workspace inside the container. "
        "Use the tools to complete the task, then summarize what you did and show the output. "
        "Always verify your work by running the code after writing it. "
        "In your final response, include the actual output from running the code."
    ),
    tools=tools,
    stop_conditions=[max_steps(MaxStepsConfig(count=50))],
)
