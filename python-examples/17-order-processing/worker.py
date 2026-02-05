"""Worker for order processing example."""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient, Worker

from tools import charge_stripe, send_confirmation_email
from agents import order_agent
from workflows import order_processing_workflow

load_dotenv()


async def main():
    """Run the worker."""
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError("POLOS_PROJECT_ID environment variable is required")

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    worker = Worker(
        client=client,
        deployment_id="order-processing",
        workflows=[order_processing_workflow],
        agents=[order_agent],
        tools=[charge_stripe, send_confirmation_email],
    )

    print("Starting order processing worker...")
    print(f"  Project ID: {project_id}")
    print("  Press Ctrl+C to stop\n")

    try:
        await worker.run()
    except KeyboardInterrupt:
        print("\nShutting down...")
        await worker.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
