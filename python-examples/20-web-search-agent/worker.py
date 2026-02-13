"""
Polos Worker for the web search agent example.

This worker registers the research agent and its tools (web search,
ask-user) with the Polos orchestrator.

Prerequisites:
    - Polos server running (polos-server start)
    - TAVILY_API_KEY set (get one at https://tavily.com)

Run with:
    python worker.py

Environment variables:
    POLOS_PROJECT_ID    - Your project ID (required)
    POLOS_API_URL       - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY       - API key for authentication (optional for local dev)
    POLOS_DEPLOYMENT_ID - Deployment ID (default: web-search-agent-examples)
    ANTHROPIC_API_KEY   - Anthropic API key for the agent
    TAVILY_API_KEY      - Tavily API key for web search
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient, Worker

from agents import research_agent, web_search, ask_user

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

    # Register the agent and all tools with the worker
    worker = Worker(
        client=client,
        agents=[research_agent],
        tools=[web_search, ask_user],
    )

    print("Starting web search agent worker...")
    print(f"  Project ID: {project_id}")
    print(f"  Agent: {research_agent.id}")
    print(f"  Tools: [{web_search.id}, {ask_user.id}]")
    print("  Press Ctrl+C to stop\n")

    try:
        await worker.run()
    except KeyboardInterrupt:
        print("\nShutting down worker...")


if __name__ == "__main__":
    asyncio.run(main())
