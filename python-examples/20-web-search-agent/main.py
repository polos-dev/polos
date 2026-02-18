"""
Interactive research assistant with web search and streaming.

Prompts the user for a research question, streams the agent's activity
(tool calls, text), handles ask_user and tool approval suspend events
(prompts the user in the terminal and resumes), then displays the final answer.

Run with:
    python main.py
"""

import asyncio
import json
import sys
import uuid

from dotenv import load_dotenv
from polos import Polos
from polos.features import events

from agents import research_agent

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


async def stream_events(polos, handle):
    """Yield suspend events from the workflow stream.

    Non-suspend events (text deltas, tool calls) are printed as side effects.
    """
    async for event in events.stream_workflow(polos, handle.root_workflow_id, handle.id):
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
            fn = tool_call.get("function", {}) if isinstance(tool_call, dict) else {}
            tool_name = fn.get("name", "unknown") if isinstance(fn, dict) else "unknown"
            raw_args = fn.get("arguments", "{}") if isinstance(fn, dict) else "{}"
            tool_args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})

            if tool_name == "web_search":
                query = tool_args.get("query", "")
                print(f'\n  [Searching the web: "{query}"]')
            elif tool_name == "ask_user":
                print("\n  [Agent has a question...]")
            else:
                print(f"\n  [Using {tool_name}...]")


# -- Tool approval suspend handler -------------------------------------------


async def handle_tool_approval(polos, handle, suspend: dict) -> None:
    """Display the tool name and input, ask the user to approve or reject."""
    form = suspend["data"].get("_form", {}) if isinstance(suspend["data"], dict) else {}
    context = form.get("context", {})
    tool_name = str(context.get("tool", "unknown"))
    tool_input = context.get("input")

    print_banner("TOOL APPROVAL REQUIRED")
    print(f'\n  The agent wants to use the "{tool_name}" tool.\n')
    if tool_input is not None:
        print(f"  Input: {json.dumps(tool_input, indent=2)}\n")

    approved = ask_yes_no("  Approve this tool call?")

    feedback = None
    if not approved:
        response = ask("  Feedback (tell the agent what to do instead): ")
        if response:
            feedback = response

    resume_data = {"approved": approved}
    if feedback:
        resume_data["feedback"] = feedback

    if approved:
        print("\n  -> Approved. Resuming workflow...\n")
    else:
        print(f"\n  -> Rejected{' with feedback' if feedback else ''}. Resuming workflow...\n")

    await polos.resume(
        suspend_workflow_id=handle.root_workflow_id,
        suspend_execution_id=handle.id,
        suspend_step_key=suspend["step_key"],
        data=resume_data,
    )


# -- Ask-user suspend handler ------------------------------------------------


async def handle_ask_user(polos, handle, suspend: dict) -> None:
    """Display the agent's question and collect the user's response."""
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
    await polos.resume(
        suspend_workflow_id=handle.root_workflow_id,
        suspend_execution_id=handle.id,
        suspend_step_key=suspend["step_key"],
        data=resume_data,
    )


# -- Main ---------------------------------------------------------------------


async def main() -> None:
    async with Polos(log_file="polos.log") as polos:
        print_banner("Web Search Research Agent")
        print("\n  Ask a research question and the agent will search the web")
        print("  for current information. It may ask follow-up questions to")
        print("  refine its research.\n")

        question = ask("  What would you like to research?\n\n  > ")
        if not question:
            print("  No question provided. Exiting.")
            return

        print()
        print("-" * 60)

        session_id = str(uuid.uuid4())

        print("\nInvoking research agent...")
        handle = await polos.invoke(
            research_agent.id, {"input": question, "streaming": True}, session_id=session_id
        )
        print(f"Execution ID: {handle.id}")
        print("Streaming agent activity...\n")

        async for suspend in stream_events(polos, handle):
            if suspend["step_key"].startswith("approve_"):
                await handle_tool_approval(polos, handle, suspend)
            elif suspend["step_key"].startswith("ask_user"):
                await handle_ask_user(polos, handle, suspend)
            else:
                print(f"\nReceived unexpected suspend: {suspend['step_key']}")

        # Fetch final result
        print("\n" + "-" * 60)
        print("\nFetching final result...")

        await asyncio.sleep(2)
        execution = await polos.get_execution(handle.id)

        if execution.get("status") == "completed":
            print_banner("Research Complete")
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
