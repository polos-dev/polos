"""
Demonstrate agent execution with lifecycle hooks.

Run with:
    python main.py

Watch the terminal to see the hooks being triggered!
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos

from agents import logged_agent, simple_logged_agent

load_dotenv()


async def main():
    """Run the lifecycle hooks demos."""
    async with Polos(log_file="polos.log") as polos:
        print("=" * 60)
        print("Lifecycle Hooks Demo")
        print("=" * 60)
        print()
        print("This demo invokes agents with lifecycle hooks attached.")
        print("Watch the terminal to see the hooks being triggered!")
        print()
        print("-" * 60)

        # Demo 1
        print("\n[Demo 1] Running logged_agent with search tool...")
        print("Request: 'Search for information about Python programming'")
        print()

        try:
            result = await logged_agent.run(
                polos,
                "Search for information about Python programming"
            )
            print(f"Result: {result.result}")
        except Exception as e:
            print(f"Error: {e}")

        print()
        print("-" * 60)

        # Demo 2
        print("\n[Demo 2] Running logged_agent with calculator...")
        print("Request: 'What is 42 * 17?'")
        print()

        try:
            result = await logged_agent.run(
                polos,
                "What is 42 * 17?"
            )
            print(f"Result: {result.result}")
        except Exception as e:
            print(f"Error: {e}")

        print()
        print("-" * 60)

        # Demo 3
        print("\n[Demo 3] Running simple_logged_agent (start/end hooks only)...")
        print("Request: 'What is the capital of France?'")
        print()

        try:
            result = await simple_logged_agent.run(
                polos,
                "What is the capital of France?"
            )
            print(f"Result: {result.result}")
        except Exception as e:
            print(f"Error: {e}")

        print()
        print("=" * 60)
        print("Demo complete! Check the terminal output for hook logs.")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
