"""
Polos Worker for the approval page example.

Registers the deploy_with_approval workflow with the orchestrator.

Prerequisites:
    - Polos server running (polos-server start)

Run with:
    python worker.py

Environment variables:
    POLOS_PROJECT_ID    - Your project ID (required)
    POLOS_API_URL       - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY       - API key for authentication (optional for local dev)
    POLOS_DEPLOYMENT_ID - Deployment ID (default: approval-page-examples)
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient, Worker

from workflows import deploy_workflow

load_dotenv()


async def main():
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). "
            "You can get this from the output printed by `polos-server start` or from the UI page at "
            "http://localhost:5173/projects/settings (the ID will be below the project name 'default')"
        )

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    worker = Worker(
        client=client,
        workflows=[deploy_workflow],
        agents=[],
        tools=[],
    )

    print("Starting approval page worker...")
    print(f"  Project ID: {project_id}")
    print(f"  Workflow: {deploy_workflow.id}")
    print("  Press Ctrl+C to stop\n")

    try:
        await worker.run()
    except KeyboardInterrupt:
        print("\nShutting down worker...")


if __name__ == "__main__":
    asyncio.run(main())
