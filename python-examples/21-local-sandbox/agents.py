"""Agent with sandbox tools running locally on the host machine.

Uses env='local' instead of Docker -- commands run directly on your
machine. Exec security defaults to 'approval-always' since there's no
container isolation: every shell command suspends for user approval.

File operations (read, write, edit) use path_restriction to prevent
the agent from accessing files outside the workspace directory.
"""

import os

from polos import (
    Agent,
    max_steps,
    MaxStepsConfig,
    sandbox_tools,
    SandboxToolsConfig,
    LocalEnvironmentConfig,
)

# Workspace directory -- the agent operates here
workspace_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace")

# Create sandbox tools that run locally on the host
tools = sandbox_tools(
    SandboxToolsConfig(
        env="local",
        local=LocalEnvironmentConfig(
            cwd=workspace_dir,
            path_restriction=workspace_dir,  # prevent file access outside workspace
        ),
        # Exec defaults to 'approval-always' for local mode.
        # Write and edit also require approval (file_approval defaults to 'always').
        # You can override these defaults:
        #
        # exec=ExecToolConfig(
        #     security="allowlist",
        #     allowlist=["node *", "cat *", "ls *", "ls", "echo *"],
        # ),
        # file_approval="none",  # disable write/edit approval
    )
)

# Define an agent that can write and run code locally
coding_agent = Agent(
    id="local_coding_agent",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt=(
        f"You are a coding agent with access to the local filesystem. "
        f"You can create files, edit code, run shell commands, and search the codebase. "
        f"Your workspace is at {workspace_dir}. "
        f"Use the tools to complete the task, then summarize what you did and show the output. "
        f"Always verify your work by running the code after writing it. "
        f"In your final response, include the actual output from running the code."
    ),
    tools=tools,
    stop_conditions=[max_steps(MaxStepsConfig(count=30))],
)
