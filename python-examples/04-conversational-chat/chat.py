"""
Interactive chat client with streaming and tool execution display.

Run with:
    python chat.py
"""

import asyncio
import uuid

from dotenv import load_dotenv
from polos import Polos

from agents import chat_assistant

load_dotenv()


async def chat_loop(polos):
    """Run an interactive chat loop with streaming responses."""
    session_id = str(uuid.uuid4())

    print("=" * 60)
    print("Conversational Chat with Streaming")
    print("=" * 60)
    print(f"Session ID: {session_id}")
    print("Type 'quit' or 'exit' to end the conversation.")
    print("=" * 60)
    print()

    while True:
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

        print("Assistant: ", end="", flush=True)

        try:
            result = await chat_assistant.stream(
                polos,
                user_input,
                session_id=session_id
            )

            async for event in result.events:
                event_type = event.event_type

                if event_type == "text_delta":
                    content = event.data.get("content", "")
                    print(content, end="", flush=True)

                elif event_type == "tool_call":
                    tool_name = event.data.get("tool_call", {}).get("function", {}).get("name", "unknown")
                    print(f"\n  [Using {tool_name}...]", end="", flush=True)

            print()
            print()

        except Exception as e:
            print(f"\nError: {e}")
            print()


async def main():
    """Main entry point."""
    async with Polos(log_file="polos.log") as polos:
        await chat_loop(polos)


if __name__ == "__main__":
    asyncio.run(main())
