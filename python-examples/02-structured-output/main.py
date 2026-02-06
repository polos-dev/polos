"""
Run the movie_reviewer agent.

This script invokes the movie_reviewer agent and waits for the result.

Run with:
    python main.py

Environment variables:
    POLOS_PROJECT_ID - Your project ID (required)
    POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient

from agents import movie_reviewer

load_dotenv()


async def main():
    """Run the movie_reviewer agent."""
    # Get project_id from environment
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). "
            "You can get this from the output printed by `polos-server start` or from the UI page at "
            "http://localhost:5173/projects/settings (the ID will be below the project name 'default')"
        )

    # Create Polos client
    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    print("Invoking movie_reviewer agent...")

    result = await movie_reviewer.run(
        client, "What's the review for the movie 'The Dark Knight'?"
    )

    print(result.result)


if __name__ == "__main__":
    asyncio.run(main())
