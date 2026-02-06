"""
Polos Worker for the Guardrails example.

Run with:
    python worker.py
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient, Worker

from agents import safe_assistant, content_generator, simple_agent

load_dotenv()


async def main():
    """Main function to run the worker."""
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

    worker = Worker(
        client=client,
        agents=[safe_assistant, content_generator, simple_agent],
    )

    print("Starting Guardrails Examples worker...")
    print(f"  Project ID: {project_id}")
    print(f"  Agents: {[a.id for a in worker.agents]}")
    print("  Press Ctrl+C to stop\n")

    try:
        await worker.run()
    except KeyboardInterrupt:
        print("\nShutting down worker...")
        await worker.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
