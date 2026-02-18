"""
Session Sandbox Example -- reusing a sandbox across multiple agent runs.

Demonstrates session-scoped sandboxes: two separate invoke() calls share
the same sessionId, so the second agent run can see files created by the
first. The Docker container persists between runs and is cleaned up
automatically when idle.

Prerequisites:
    - Docker must be installed and running
    - Polos server running (polos-server start)

Run:
    python main.py

Environment variables:
    POLOS_PROJECT_ID     - Your project ID (default from env)
    POLOS_API_URL        - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY        - API key for authentication (optional for local dev)
    POLOS_WORKSPACES_DIR - Base path for sandbox workspaces (default: ~/.polos/workspaces)
    ANTHROPIC_API_KEY    - Anthropic API key for the coding agent
"""

import asyncio
import uuid

from dotenv import load_dotenv
from polos import Polos
from polos.features import events

from agents import coding_agent

load_dotenv()


# -- Helpers ------------------------------------------------------------------


def print_banner(text: str) -> None:
    line = "=" * 60
    print(f"\n{line}")
    print(f"  {text}")
    print(line)


async def stream_activity(polos, handle) -> None:
    """Stream agent activity (text deltas, tool calls) until the workflow completes."""
    async for event in events.stream_workflow(polos, handle.root_workflow_id, handle.id):
        event_type = event.event_type

        if event_type == "text_delta":
            content = event.data.get("content") if isinstance(event.data, dict) else None
            if isinstance(content, str):
                print(content, end="", flush=True)
        elif event_type == "tool_call":
            tool_call = event.data.get("tool_call", {}) if isinstance(event.data, dict) else {}
            tool_name = tool_call.get("function", {}).get("name", "unknown")
            print(f"\n  [Using {tool_name}...]")


async def run_agent(polos, task: str, session_id: str, label: str) -> None:
    """Invoke the agent, stream its output, and print the final result."""
    print_banner(label)
    print(f"\n  Task: {task}\n")
    print(f"  Session ID: {session_id}\n")
    print("-" * 60)

    handle = await polos.invoke(
        coding_agent.id, {"input": task, "streaming": True}, session_id=session_id
    )
    print(f"\nExecution ID: {handle.id}")
    print("Streaming agent activity...\n")

    await stream_activity(polos, handle)

    # Fetch final result
    print("\n" + "-" * 60)
    print("\nFetching final result...")

    await asyncio.sleep(2)
    execution = await polos.get_execution(handle.id)

    if execution.get("status") == "completed":
        result = execution.get("result", "")
        if isinstance(result, str):
            print(f"\n{result}\n")
        else:
            import json

            print(f"\n{json.dumps(result, indent=2)}\n")
    else:
        print(f"\nFinal status: {execution.get('status')}")
        if execution.get("result"):
            print(execution["result"])


# -- Main ---------------------------------------------------------------------


async def main() -> None:
    async with Polos(log_file="polos.log") as polos:
        # A single session ID shared across both agent runs.
        # This causes the SandboxManager to reuse the same Docker container,
        # so files and state persist between invocations.
        session_id = str(uuid.uuid4())

        # -- Run 1: Create a utility module ------------------------------------
        await run_agent(
            polos,
            (
                "Create a file called math-utils.js with two exported functions: "
                "`add(a, b)` and `multiply(a, b)`. "
                "Then create a test file called test-math.js that requires math-utils.js, "
                'runs a few assertions, and prints "All tests passed!" if they succeed. '
                "Run the test file with node."
            ),
            session_id,
            "Run 1: Create math-utils and test it",
        )

        # -- Run 2: Build on top of what Run 1 created ------------------------
        await run_agent(
            polos,
            (
                "List the files in /workspace to see what already exists. "
                "Then add a `subtract(a, b)` function to the existing math-utils.js file. "
                "Update test-math.js to also test subtract. "
                "Run the tests again with node."
            ),
            session_id,
            "Run 2: Extend math-utils (same sandbox)",
        )


if __name__ == "__main__":
    asyncio.run(main())
