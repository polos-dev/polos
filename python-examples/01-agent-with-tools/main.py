"""
Run the weather agent.

Run with:
    python main.py
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos

from agents import weather_agent

load_dotenv()


async def main():
    """Run the weather agent."""
    async with Polos(log_file="polos.log") as polos:
        print("Invoking weather_agent...")

        result = await weather_agent.run(
            polos, "What's the weather like in New York?"
        )

        print(result.result)


if __name__ == "__main__":
    asyncio.run(main())
