def main_py_template() -> str:
    return """import asyncio
import os
from dotenv import load_dotenv
from polos import Polos

# Import agents and workflows for registration
import agents.coding_agent
import agents.assistant_agent
import workflows.text_review.agents
import workflows.text_review.workflow

load_dotenv()


async def main():
    ui_url = os.environ.get("POLOS_UI_URL", "http://localhost:5173")

    async with Polos() as polos:
        print()
        print("\\033[1mPolos worker starting...\\033[0m")
        print()
        print(f"  UI:        {ui_url}")
        print()
        print("  Run an agent:")
        print("    polos run assistant_agent")
        print('    polos run coding_agent --input "Write a hello world script"')
        print()
        print("  Run a workflow:")
        print('    polos invoke text_review --input "Your text here"')
        print()
        await polos.serve()


if __name__ == "__main__":
    asyncio.run(main())
"""
