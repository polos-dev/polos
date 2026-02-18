"""
Run the movie_reviewer agent.

Run with:
    python main.py
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos

from agents import movie_reviewer

load_dotenv()


async def main():
    """Run the movie_reviewer agent."""
    async with Polos(log_file="polos.log") as polos:
        print("Invoking movie_reviewer agent...")

        result = await movie_reviewer.run(
            polos, "What's the review for the movie 'The Dark Knight'?"
        )

        print(result.result)


if __name__ == "__main__":
    asyncio.run(main())
