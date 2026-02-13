"""
Interactive demo for exec security -- command approval in the terminal.

Invokes a coding agent whose exec tool has allowlist security. Commands
that don't match the allowlist suspend for approval. This script catches
those suspend events, shows the command to the user, and collects their
decision (approve / reject with feedback) before resuming.

Run the worker first:
    python worker.py

Then run this script:
    python main.py

Environment variables:
    POLOS_PROJECT_ID - Your project ID (required)
    POLOS_API_URL    - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY    - API key for authentication (optional for local dev)
"""

import asyncio
import os
import sys
import uuid

from dotenv import load_dotenv
from polos import PolosClient
from polos.features import events

from agents import coding_agent

load_dotenv()


# -- Helpers ------------------------------------------------------------------


def print_banner(text: str) -> None:
    line = "=" * 60
    print(f"\n{line}")
    print(f"  {text}")
    print(line)


def ask(prompt: str) -> str:
    return input(prompt).strip()


def ask_yes_no(prompt: str) -> bool:
    while True:
        answer = input(f"{prompt} (y/n): ").strip().lower()
        if answer in ("y", "yes"):
            return True
        if answer in ("n", "no"):
            return False
        print("  Please enter 'y' or 'n'")


# -- Event handling -----------------------------------------------------------


async def stream_events(client: PolosClient, handle):
    """Yield suspend events from the workflow stream.

    Non-suspend events (text deltas, tool calls) are printed as side effects.
    """
    async for event in events.stream_workflow(client, handle.root_workflow_id, handle.id):
        event_type = event.event_type

        if event_type and event_type.startswith("suspend_"):
            step_key = event_type[len("suspend_"):]
            yield {"step_key": step_key, "data": event.data}
        elif event_type == "text_delta":
            content = event.data.get("content") if isinstance(event.data, dict) else None
            if isinstance(content, str):
                sys.stdout.write(content)
                sys.stdout.flush()
        elif event_type == "tool_call":
            tool_call = event.data.get("tool_call", {}) if isinstance(event.data, dict) else {}
            tool_name = tool_call.get("function", {}).get("name", "unknown")
            print(f"\n  [Using {tool_name}...]")


# -- Approval UI --------------------------------------------------------------


async def handle_approval(client: PolosClient, handle, suspend: dict) -> None:
    """Show an approval prompt in the terminal and collect the user's decision."""
    form = suspend["data"].get("_form", {}) if isinstance(suspend["data"], dict) else {}
    context = form.get("context", {})
    print(context)
    command = str(context.get("command", "unknown"))
    cwd = str(context.get("cwd", ""))
    environment = str(context.get("environment", ""))

    print_banner("COMMAND APPROVAL REQUIRED")
    print("\n  The agent wants to run a command:\n")
    print(f"    Command:     {command}")
    if cwd:
        print(f"    Directory:   {cwd}")
    if environment:
        print(f"    Environment: {environment}")
    print()

    approved = ask_yes_no("  Approve this command?")

    feedback = None
    if not approved:
        response = ask("  Feedback (tell the agent what to do instead): ")
        if response:
            feedback = response

    resume_data = {"approved": approved, "allow_always": False}
    if feedback:
        resume_data["feedback"] = feedback

    if approved:
        print("\n  -> Approved. Resuming workflow...\n")
    else:
        print(f"\n  -> Rejected{' with feedback' if feedback else ''}. Resuming workflow...\n")

    await client.resume(
        suspend_workflow_id=handle.root_workflow_id,
        suspend_execution_id=handle.id,
        suspend_step_key=suspend["step_key"],
        data=resume_data,
    )


# -- Ask-user UI --------------------------------------------------------------


async def handle_ask_user(client: PolosClient, handle, suspend: dict) -> None:
    """Show the agent's question in the terminal and collect the user's answer."""
    form = suspend["data"].get("_form", {}) if isinstance(suspend["data"], dict) else {}
    title = str(form.get("title", "Agent Question"))
    description = str(form.get("description", ""))
    fields = form.get("fields", [])

    print_banner(title)
    if description:
        print(f"\n  {description}\n")

    resume_data = {}

    for field in fields:
        if field.get("description"):
            print(f"  ({field['description']})")

        if field.get("type") == "boolean":
            resume_data[field["key"]] = ask_yes_no(f"  {field['label']}")
        elif field.get("type") == "select" and field.get("options"):
            print(f"  {field['label']}")
            options = field["options"]
            for i, opt in enumerate(options):
                print(f"    {i + 1}. {opt['label']}")
            while True:
                choice = ask(f"  Enter choice (1-{len(options)}): ")
                try:
                    idx = int(choice) - 1
                    if 0 <= idx < len(options):
                        resume_data[field["key"]] = options[idx]["value"]
                        break
                except ValueError:
                    pass
                print("  Invalid choice, try again.")
        else:
            answer = ask(f"  {field['label']}: ")
            resume_data[field["key"]] = int(answer) if field.get("type") == "number" else answer

    print("\n  -> Sending response to agent...\n")
    await client.resume(
        suspend_workflow_id=handle.root_workflow_id,
        suspend_execution_id=handle.id,
        suspend_step_key=suspend["step_key"],
        data=resume_data,
    )


# -- Main ---------------------------------------------------------------------


async def main() -> None:
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

    print_banner("Exec Security Demo")
    print("\n  This demo shows how exec security works with an allowlist.")
    print("  Commands matching the allowlist (node, cat, echo, ls) run automatically.")
    print("  Everything else pauses for your approval.\n")
    print("  You can reject a command and provide feedback -- the agent will")
    print("  read your feedback and try a different approach.\n")
    print("  Make sure the worker is running: python worker.py\n")

    task = (
        "Create a file called greet.js that takes a name argument and prints a greeting. "
        "Run it with node to test it. "
        'Then install the "chalk" npm package and update greet.js to print the greeting in color. '
        "Run it again to verify it works."
    )

    print(f"  Task: {task}\n")
    print("-" * 60)

    conversation_id = str(uuid.uuid4())

    print("\nInvoking agent...")
    handle = await client.invoke(
        coding_agent.id, {"input": task, "conversationId": conversation_id, "streaming": True}
    )
    print(f"Execution ID: {handle.id}")
    print("Streaming agent activity...\n")

    # Event loop: single persistent stream so concurrent suspends are never missed
    async for suspend in stream_events(client, handle):
        if suspend["step_key"].startswith("approve_exec"):
            await handle_approval(client, handle, suspend)
        elif suspend["step_key"].startswith("ask_user"):
            await handle_ask_user(client, handle, suspend)
        else:
            print(f"Received unexpected suspend: {suspend['step_key']}")

    # Fetch final result
    print("-" * 60)
    print("\nFetching final result...")

    await asyncio.sleep(2)
    execution = await client.get_execution(handle.id)

    if execution.get("status") == "completed":
        print_banner("Agent Completed")
        result = execution.get("result", "")
        if isinstance(result, str):
            print(f"\n{result}\n")
        else:
            import json

            print(f"\n{json.dumps(result, indent=2)}\n")
    else:
        print(f"\nFinal status: {execution.get('status')}")
        if execution.get("result"):
            print(execution["result"])


if __name__ == "__main__":
    asyncio.run(main())
