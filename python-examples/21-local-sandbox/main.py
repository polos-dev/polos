"""
Run the local sandbox coding agent with tool approval.

Since local mode has no container isolation, destructive operations
(exec, write, edit) suspend for user approval before running.
This script handles those suspend events in the terminal.

Run the worker first:
    python worker.py

Then run this client:
    python main.py

Environment variables:
    POLOS_PROJECT_ID - Your project ID (required)
    POLOS_API_URL    - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY    - API key for authentication (optional for local dev)
"""

import asyncio
import json
import os
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


async def suspend_events(client: PolosClient, handle):
    """Yield suspend events from the workflow stream."""
    async for event in events.stream_workflow(client, handle.root_workflow_id, handle.id):
        if event.event_type and event.event_type.startswith("suspend_"):
            step_key = event.event_type[len("suspend_"):]
            yield {"step_key": step_key, "data": event.data}


# -- Exec approval UI --------------------------------------------------------


async def handle_exec_approval(client: PolosClient, handle, suspend: dict) -> None:
    """Show a command approval prompt (exec tool has its own suspend format)."""
    form = suspend["data"].get("_form", {}) if isinstance(suspend["data"], dict) else {}
    context = form.get("context", {})
    command = str(context.get("command", "unknown"))
    cwd = str(context.get("cwd", ""))

    print_banner("COMMAND APPROVAL REQUIRED")
    print("\n  The agent wants to run a command on your machine:\n")
    print(f"    Command:   {command}")
    if cwd:
        print(f"    Directory: {cwd}")
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
        print("\n  -> Approved. Resuming...\n")
    else:
        print(f"\n  -> Rejected{' with feedback' if feedback else ''}. Resuming...\n")

    await client.resume(
        suspend_workflow_id=handle.root_workflow_id,
        suspend_execution_id=handle.id,
        suspend_step_key=suspend["step_key"],
        data=resume_data,
    )


# -- File tool approval UI ---------------------------------------------------


async def handle_file_approval(client: PolosClient, handle, suspend: dict) -> None:
    """Show an approval prompt for write/edit tools."""
    form = suspend["data"].get("_form", {}) if isinstance(suspend["data"], dict) else {}
    context = form.get("context", {})
    tool_name = str(context.get("tool", "unknown"))
    tool_input = context.get("input", {})

    print_banner(f"{tool_name.upper()} APPROVAL REQUIRED")
    print(f'\n  The agent wants to use the "{tool_name}" tool:\n')

    if isinstance(tool_input, dict):
        if tool_input.get("path"):
            print(f"    Path: {tool_input['path']}")
        if tool_name == "write" and tool_input.get("content"):
            content = str(tool_input["content"])
            preview = content[:200] + "..." if len(content) > 200 else content
            indented = "\n".join(f"      {line}" for line in preview.split("\n"))
            print(f"    Content:\n{indented}")
        if tool_name == "edit":
            if tool_input.get("old_text"):
                print(f"    Old text: {tool_input['old_text']}")
            if tool_input.get("new_text"):
                print(f"    New text: {tool_input['new_text']}")
    print()

    approved = ask_yes_no("  Approve this operation?")

    feedback = None
    if not approved:
        response = ask("  Feedback (tell the agent what to do instead): ")
        if response:
            feedback = response

    resume_data = {"approved": approved}
    if feedback:
        resume_data["feedback"] = feedback

    if approved:
        print("\n  -> Approved. Resuming...\n")
    else:
        print(f"\n  -> Rejected{' with feedback' if feedback else ''}. Resuming...\n")

    await client.resume(
        suspend_workflow_id=handle.root_workflow_id,
        suspend_execution_id=handle.id,
        suspend_step_key=suspend["step_key"],
        data=resume_data,
    )


# -- Path approval UI --------------------------------------------------------


async def handle_path_approval(client: PolosClient, handle, suspend: dict) -> None:
    """Show an approval prompt when a read-only tool accesses outside workspace."""
    form = suspend["data"].get("_form", {}) if isinstance(suspend["data"], dict) else {}
    context = form.get("context", {})
    tool_name = str(context.get("tool", "unknown"))
    target_path = str(context.get("path", "unknown"))
    restriction = str(context.get("restriction", ""))

    print_banner(f"{tool_name.upper()}: PATH OUTSIDE WORKSPACE")
    print(f"\n  The agent wants to {tool_name} outside the workspace:\n")
    print(f"    Path:      {target_path}")
    if restriction:
        print(f"    Workspace: {restriction}")
    print()

    approved = ask_yes_no("  Allow this access?")

    feedback = None
    if not approved:
        response = ask("  Feedback (tell the agent what to do instead): ")
        if response:
            feedback = response

    resume_data = {"approved": approved}
    if feedback:
        resume_data["feedback"] = feedback

    if approved:
        print("\n  -> Allowed. Resuming...\n")
    else:
        print(f"\n  -> Denied{' with feedback' if feedback else ''}. Resuming...\n")

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

    print_banner("Local Sandbox Demo")
    print("\n  This demo runs an agent with local sandbox tools (no Docker).")
    print("  Since there is no container isolation:\n")
    print("  - exec, write, edit: always require approval")
    print("  - read, glob, grep: free within workspace, approval if outside\n")
    print("  Make sure the worker is running: python worker.py\n")

    task = (
        'Create a file called hello.js that prints "Hello from the local sandbox!" and run it. '
        "Then create a second file called fibonacci.js that computes the first 10 Fibonacci numbers "
        "and prints them. Run that too."
    )

    print(f"  Task: {task}\n")
    print("-" * 60)

    conversation_id = str(uuid.uuid4())

    print("\nInvoking agent...")
    handle = await client.invoke(
        coding_agent.id, {"input": task, "conversationId": conversation_id, "streaming": True}
    )
    print(f"Execution ID: {handle.id}")
    print("Waiting for agent activity...\n")

    # Event loop: single persistent stream so concurrent suspends are never missed
    async for suspend in suspend_events(client, handle):
        step_key = suspend["step_key"]
        if step_key.startswith("approve_exec"):
            await handle_exec_approval(client, handle, suspend)
        elif step_key.startswith("approve_write") or step_key.startswith("approve_edit"):
            await handle_file_approval(client, handle, suspend)
        elif (
            step_key.startswith("approve_read")
            or step_key.startswith("approve_glob")
            or step_key.startswith("approve_grep")
        ):
            await handle_path_approval(client, handle, suspend)
        else:
            print(f"Received unexpected suspend: {step_key}")

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
            print(f"\n{json.dumps(result, indent=2)}\n")
    else:
        print(f"\nFinal status: {execution.get('status')}")
        if execution.get("result"):
            print(execution["result"])


if __name__ == "__main__":
    asyncio.run(main())
