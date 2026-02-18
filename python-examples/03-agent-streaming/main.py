"""
Client demonstrating how to consume streaming agent responses.

Run with:
    python main.py
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos

from agents import storyteller

load_dotenv()


async def stream_text_chunks(polos):
    """Demonstrate streaming text chunks only."""
    print("=" * 60)
    print("Example 1: Streaming Text Chunks")
    print("=" * 60)

    # Invoke with streaming=True
    result = await storyteller.stream(
        polos,
        "Tell me a short story about a robot learning to paint",
    )

    print(f"Agent run ID: {result.agent_run_id}")
    print(f"Topic: {result.topic}")
    print("\nStreaming response:\n")

    # Iterate over text chunks as they arrive
    async for chunk in result.text_chunks:
        print(chunk, end="", flush=True)

    print("\n")


async def stream_full_events(polos):
    """Demonstrate streaming all events including tool calls."""
    print("=" * 60)
    print("Example 2: Streaming Full Events")
    print("=" * 60)

    result = await storyteller.stream(
        polos,
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


async def get_final_text(polos):
    """Demonstrate getting the final accumulated text."""
    print("=" * 60)
    print("Example 3: Get Final Text")
    print("=" * 60)

    result = await storyteller.stream(
        polos,
        "What are three benefits of reading books?"
    )

    # Get the final accumulated text (waits for completion)
    final_text = await result.text()

    print(f"Agent run ID: {result.agent_run_id}")
    print(f"\nFinal text:\n{final_text}")
    print()


async def main():
    """Run all streaming examples."""
    async with Polos(log_file="polos.log") as polos:
        await stream_text_chunks(polos)
        await stream_full_events(polos)
        await get_final_text(polos)


if __name__ == "__main__":
    asyncio.run(main())
