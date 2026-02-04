"""
Client demonstrating how to consume streaming agent responses.

Run the worker first:
    python worker.py

Then run this client:
    python main.py
"""

import asyncio
import os
import json

from dotenv import load_dotenv
from polos import PolosClient

from agents import storyteller

load_dotenv()


async def stream_text_chunks():
    """Demonstrate streaming text chunks only."""
    print("=" * 60)
    print("Example 1: Streaming Text Chunks")
    print("=" * 60)

    client = PolosClient(
        project_id=os.getenv("POLOS_PROJECT_ID"),
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    # Invoke with streaming=True
    result = await storyteller.stream(
        client,
        "Tell me a short story about a robot learning to paint",
    )

    print(f"Agent run ID: {result.agent_run_id}")
    print(f"Topic: {result.topic}")
    print("\nStreaming response:\n")

    # Iterate over text chunks as they arrive
    async for chunk in result.text_chunks:
        print(chunk, end="", flush=True)

    print("\n")


async def stream_full_events():
    """Demonstrate streaming all events including tool calls."""
    print("=" * 60)
    print("Example 2: Streaming Full Events")
    print("=" * 60)

    client = PolosClient(
        project_id=os.getenv("POLOS_PROJECT_ID"),
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    result = await storyteller.stream(
        client,
        "Write a haiku about mountains",
    )

    print(f"Agent run ID: {result.agent_run_id}")
    print("\nStreaming events:\n")

    # Iterate over all events
    async for event in result.events:
        event_type = event.event_type

        if event_type == "text_delta":
            # Text chunk received
            content = event.data.get("content", "")
            print(content, end="", flush=True)

        elif event_type == "tool_call":
            # Tool was called
            tool_name = event.data.get("tool_call", {}).get("function", {}).get("name", "unknown")
            print(f"\n[Tool Called: {tool_name}]")

        elif event_type == "agent_finish":
            # Agent finished
            print("\n[Agent completed]")

    print("\n")


async def get_final_text():
    """Demonstrate getting the final accumulated text."""
    print("=" * 60)
    print("Example 3: Get Final Text")
    print("=" * 60)

    client = PolosClient(
        project_id=os.getenv("POLOS_PROJECT_ID"),
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    result = await storyteller.stream(
        client,
        "What are three benefits of reading books?"
    )

    # Get the final accumulated text (waits for completion)
    final_text = await result.text()

    print(f"Agent run ID: {result.agent_run_id}")
    print(f"\nFinal text:\n{final_text}")
    print()


async def main():
    """Run all streaming examples."""
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Get it from the Polos UI at http://localhost:5173/projects/settings"
        )

    await stream_text_chunks()
    await stream_full_events()
    await get_final_text()


if __name__ == "__main__":
    asyncio.run(main())
