"""
Run the coding agent with sandbox tools and stream activity.

This script invokes the coding agent, streams text and tool-call events
in real time, then displays the final result.

Run the worker first:
    python worker.py

Then run this client:
    python main.py

Environment variables:
    POLOS_PROJECT_ID - Your project ID (required)
    POLOS_API_URL    - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY    - API key for authentication (optional for local dev)
"""

import asyncio
import os
import sys
import uuid

from dotenv import load_dotenv
from polos import PolosClient
from polos.features import events

from agents import coding_agent

load_dotenv()


async def stream_activity(client: PolosClient, handle) -> None:
    """Stream agent activity (text deltas, tool calls) until the workflow completes."""
    async for event in events.stream_workflow(client, handle.root_workflow_id, handle.id):
        event_type = event.event_type

        if event_type == "text_delta":
            content = event.data.get("content") if isinstance(event.data, dict) else None
            if isinstance(content, str):
                print(content, end="", flush=True)
        elif event_type == "tool_call":
            tool_call = event.data.get("tool_call", {}) if isinstance(event.data, dict) else {}
            tool_name = tool_call.get("function", {}).get("name", "unknown")
            print(f"\n  [Using {tool_name}...]")


async def main() -> None:
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). "
            "You can get this from the output printed by `polos-server start` or from the UI page at "
            "http://localhost:5173/projects/settings (the ID will be below the project name 'default')"
        )

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    task = (
        'Create a file called hello.js that prints "Hello from the sandbox!" and run it. '
        "Then create a second file called fibonacci.js that computes the first 10 Fibonacci numbers "
        "and prints them. Run that too."
    )

    session_id = str(uuid.uuid4())

    print("Invoking coding agent...\n")
    handle = await client.invoke(
        coding_agent.id, {"input": task, "streaming": True}, session_id=session_id
    )
    print(f"Execution ID: {handle.id}")
    print("Streaming agent activity...\n")

    await stream_activity(client, handle)

    # Fetch final result
    print("\n" + "-" * 60)
    print("\nFetching final result...")

    await asyncio.sleep(2)
    execution = await client.get_execution(handle.id)

    if execution.get("status") == "completed":
        line = "=" * 60
        print(f"\n{line}")
        print("  Agent Completed")
        print(line)
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


if __name__ == "__main__":
    asyncio.run(main())
