"""Agent with sandbox tools and exec security.

The exec tool is configured with an allowlist: commands matching the
patterns run immediately, everything else suspends for user approval.
The user can approve, reject, or reject with feedback so the agent
can adjust its approach.
"""

import os

from polos import (
    Agent,
    max_steps,
    MaxStepsConfig,
    sandbox_tools,
    SandboxToolsConfig,
    DockerEnvironmentConfig,
    ExecToolConfig,
    create_ask_user_tool,
)

workspace_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace")

# Sandbox tools with exec security -- only allowlisted commands run
# without approval. Everything else suspends for the user to decide.
tools = sandbox_tools(
    SandboxToolsConfig(
        env="docker",
        docker=DockerEnvironmentConfig(
            image="node:20-slim",
            workspace_dir=workspace_dir,
            network="bridge",
        ),
        exec=ExecToolConfig(
            security="allowlist",
            allowlist=[
                "node *",   # allow running node scripts
                "cat *",    # allow reading files
                "echo *",   # allow echo
                "ls *",     # allow listing
                "ls",       # allow bare ls
            ],
        ),
    )
)

# Ask-user tool -- lets the agent ask the user questions during execution
ask_user = create_ask_user_tool()

# Define the agent
coding_agent = Agent(
    id="secure_coding_agent",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt=(
        "You are a coding agent with access to a sandbox environment. "
        "You can create files, edit code, run shell commands, and search the codebase. "
        "The workspace is at /workspace inside the container. "
        "Some commands may need user approval before running. If a command is rejected, "
        "read the user feedback in the error output and adjust your approach accordingly. "
        "Always verify your work by running the code after writing it. "
        "If you need clarification or a decision from the user, use the ask_user tool."
    ),
    tools=[*tools, ask_user],
    stop_conditions=[max_steps(MaxStepsConfig(count=30))],
    conversation_history=50,
)
