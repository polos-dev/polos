"""
Polos Worker for the sandbox tools example.

This worker registers the coding agent and its sandbox tools with the
Polos orchestrator. The agent can execute code inside a Docker container.

Prerequisites:
    - Docker must be installed and running
    - Polos server running (polos-server start)

Run with:
    python worker.py

Environment variables:
    POLOS_PROJECT_ID    - Your project ID (required)
    POLOS_API_URL       - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY       - API key for authentication (optional for local dev)
    POLOS_DEPLOYMENT_ID - Deployment ID (default: sandbox-tools-examples)
    ANTHROPIC_API_KEY   - Anthropic API key for the coding agent
"""

import asyncio
import os
import signal

from dotenv import load_dotenv
from polos import PolosClient, Worker

from agents import coding_agent, tools

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

    # Register the agent and all sandbox tools with the worker
    worker = Worker(
        client=client,
        agents=[coding_agent],
        tools=list(tools),
    )

    print("Starting sandbox tools worker...")
    print(f"  Project ID: {project_id}")
    print(f"  Agent: {coding_agent.id}")
    print(f"  Tools: [{', '.join(t.id for t in tools)}]")
    print("  Press Ctrl+C to stop\n")

    # Clean up Docker container on shutdown
    loop = asyncio.get_event_loop()

    def handle_sigint():
        print("\nShutting down -- cleaning up sandbox...")
        asyncio.ensure_future(_cleanup_and_exit())

    async def _cleanup_and_exit():
        await tools.cleanup()
        loop.stop()

    loop.add_signal_handler(signal.SIGINT, handle_sigint)

    try:
        await worker.run()
    except KeyboardInterrupt:
        print("\nShutting down -- cleaning up sandbox...")
        await tools.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
