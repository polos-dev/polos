"""
Run the coding agent with sandbox tools and stream activity.

Run with:
    python main.py
"""

import asyncio
import uuid

from dotenv import load_dotenv
from polos import Polos
from polos.features import events

from agents import coding_agent

load_dotenv()


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


async def main() -> None:
    async with Polos(log_file="polos.log") as polos:
        task = (
            'Create a file called hello.js that prints "Hello from the sandbox!" and run it. '
            "Then create a second file called fibonacci.js that computes the first 10 Fibonacci numbers "
            "and prints them. Run that too."
        )

        session_id = str(uuid.uuid4())

        print("Invoking coding agent...\n")
        handle = await polos.invoke(
            coding_agent.id, {"input": task, "streaming": True}, session_id=session_id
        )
        print(f"Execution ID: {handle.id}")
        print("Streaming agent activity...\n")

        await stream_activity(polos, handle)

        # Fetch final result
        print("\n" + "-" * 60)
        print("\nFetching final result...")

        await asyncio.sleep(2)
        execution = await polos.get_execution(handle.id)

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
