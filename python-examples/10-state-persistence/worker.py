"""
Polos Worker for the State Persistence example.

Run with:
    python worker.py
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient, Worker

from workflows import (
    counter_workflow,
    shopping_cart_workflow,
    stateful_with_initial_state,
)

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
        deployment_id="state-persistence-examples",
        workflows=[
            counter_workflow,
            shopping_cart_workflow,
            stateful_with_initial_state,
        ],
    )

    print("Starting State Persistence Examples worker...")
    print(f"  Project ID: {project_id}")
    print(f"  Workflows: {[w.id for w in worker.workflows]}")
    print("  Press Ctrl+C to stop\n")

    try:
        await worker.run()
    except KeyboardInterrupt:
        print("\nShutting down worker...")
        await worker.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
