"""
Polos Worker for the Structured Output example.

This example demonstrates how to use Pydantic models to get
structured, typed responses from agents.

Run with:
    python worker.py

Environment variables:
    POLOS_PROJECT_ID - Your project ID (required)
    POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
    OPENAI_API_KEY - OpenAI API key
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient, Worker

from agents import movie_reviewer, recipe_generator, sentiment_analyzer

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
        agents=[movie_reviewer, recipe_generator, sentiment_analyzer],
    )

    print("Starting Structured Output Examples worker...")
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
