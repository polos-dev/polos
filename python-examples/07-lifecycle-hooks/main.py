"""
Demonstrate agent execution with lifecycle hooks.

Run the worker first:
    python worker.py

Then run this script:
    python main.py

Watch the worker terminal to see the hooks being triggered!
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient

from agents import logged_agent, simple_logged_agent

load_dotenv()


async def run_logged_agent_demo():
    """Run the logged_agent and observe hooks in the worker terminal."""
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Get it from the Polos UI at http://localhost:5173/projects/settings"
        )

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
        deployment_id="lifecycle-hooks-examples",
    )

    print("=" * 60)
    print("Lifecycle Hooks Demo")
    print("=" * 60)
    print()
    print("This demo invokes agents with lifecycle hooks attached.")
    print("Watch the WORKER terminal to see the hooks being triggered!")
    print()
    print("-" * 60)

    # Demo 1: Agent with full lifecycle logging and tools
    print("\n[Demo 1] Running logged_agent with search tool...")
    print("Request: 'Search for information about Python programming'")
    print()

    try:
        result = await logged_agent.run(
            client,
            "Search for information about Python programming"
        )
        print(f"Result: {result.result}")
    except Exception as e:
        print(f"Error: {e}")

    print()
    print("-" * 60)

    # Demo 2: Agent with calculator tool
    print("\n[Demo 2] Running logged_agent with calculator...")
    print("Request: 'What is 42 * 17?'")
    print()

    try:
        result = await logged_agent.run(
            client,
            "What is 42 * 17?"
        )
        print(f"Result: {result.result}")
    except Exception as e:
        print(f"Error: {e}")

    print()
    print("-" * 60)

    # Demo 3: Simple agent with just start/end hooks
    print("\n[Demo 3] Running simple_logged_agent (start/end hooks only)...")
    print("Request: 'What is the capital of France?'")
    print()

    try:
        result = await simple_logged_agent.run(
            client,
            "What is the capital of France?"
        )
        print(f"Result: {result.result}")
    except Exception as e:
        print(f"Error: {e}")

    print()
    print("=" * 60)
    print("Demo complete! Check the worker terminal for hook logs.")
    print("=" * 60)


async def main():
    """Main entry point."""
    await run_logged_agent_demo()


if __name__ == "__main__":
    asyncio.run(main())
