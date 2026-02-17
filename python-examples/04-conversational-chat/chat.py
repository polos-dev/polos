"""
Interactive chat client with streaming and tool execution display.

Run the worker first:
    python worker.py

Then run this chat client:
    python chat.py
"""

import asyncio
import os
import uuid

from dotenv import load_dotenv
from polos import PolosClient

from agents import chat_assistant

load_dotenv()


async def chat_loop():
    """Run an interactive chat loop with streaming responses."""
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Get it from the Polos UI at http://localhost:5173/projects/settings"
        )

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    # Generate a session ID to maintain conversation context
    session_id = str(uuid.uuid4())

    print("=" * 60)
    print("Conversational Chat with Streaming")
    print("=" * 60)
    print(f"Session ID: {session_id}")
    print("Type 'quit' or 'exit' to end the conversation.")
    print("=" * 60)
    print()

    while True:
        # Get user input
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        if user_input.lower() in ("quit", "exit"):
            print("Goodbye!")
            break

        # Invoke agent with streaming, using session_id for conversation context
        print("Assistant: ", end="", flush=True)

        try:
            result = await chat_assistant.stream(
                client,
                user_input,
                session_id=session_id
            )

            # Stream the response with tool call indicators
            async for event in result.events:
                event_type = event.event_type

                if event_type == "text_delta":
                    content = event.data.get("content", "")
                    print(content, end="", flush=True)

                elif event_type == "tool_call":
                    tool_name = event.data.get("tool_call", {}).get("function", {}).get("name", "unknown")
                    print(f"\n  [Using {tool_name}...]", end="", flush=True)

            print()  # New line after response
            print()  # Extra spacing

        except Exception as e:
            print(f"\nError: {e}")
            print()


async def main():
    """Main entry point."""
    await chat_loop()


if __name__ == "__main__":
    asyncio.run(main())
