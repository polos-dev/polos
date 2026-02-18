"""
Run the thinking agent with streaming.

Run with:
    python main.py
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos

from agents import thinking_agent

load_dotenv()


async def main():
    """Run the thinking agent."""
    async with Polos(log_file="polos.log") as polos:
        print("Invoking thinking agent...")

        result = await thinking_agent.stream(
            polos,
            "A farmer has 17 sheep. All but 9 run away. How many sheep does the farmer have left?"
        )

        async for chunk in result.text_chunks:
            print(chunk, end="", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
