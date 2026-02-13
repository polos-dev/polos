"""
Polos Worker for the exec security example.

Registers the coding agent and its sandbox tools. The exec tool is
configured with an allowlist -- non-matching commands suspend for
user approval before running.

Prerequisites:
    - Docker must be installed and running
    - Polos server running (polos-server start)

Run with:
    python worker.py

Environment variables:
    POLOS_PROJECT_ID    - Your project ID (required)
    POLOS_API_URL       - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY       - API key for authentication (optional for local dev)
    POLOS_DEPLOYMENT_ID - Deployment ID (default: exec-security-examples)
    ANTHROPIC_API_KEY   - Anthropic API key for the coding agent
"""

import asyncio
import os
import signal

from dotenv import load_dotenv
from polos import PolosClient, Worker

from agents import coding_agent, tools, ask_user

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
        agents=[coding_agent],
        tools=[*tools, ask_user],
    )

    print("Starting exec security worker...")
    print(f"  Project ID: {project_id}")
    print(f"  Agent: {coding_agent.id}")
    print(f"  Tools: [{', '.join(t.id for t in tools)}, {ask_user.id}]")
    print("  Exec security: allowlist mode")
    print("  Press Ctrl+C to stop\n")

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
