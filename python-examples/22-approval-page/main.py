"""
Approval Page Example

Starts a deployment workflow that suspends for human approval.
When it suspends, the script prints an approval URL -- open it in your
browser to see the form, fill it in, and click Submit. The workflow
then resumes automatically with the submitted data.

Prerequisites:
    1. Orchestrator + UI running  (polos-server start)

Run:
    python main.py
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import Polos
from polos.features import events

from workflows import deploy_workflow

load_dotenv()


async def main() -> None:
    api_url = os.getenv("POLOS_API_URL", "http://localhost:8080")

    async with Polos(log_file="polos.log") as polos:
        # Start the deployment workflow
        print("Starting deployment workflow...")
        handle = await deploy_workflow.invoke(
            polos,
            {
                "service": "api-gateway",
                "version": "2.4.0",
                "environment": "production",
            },
        )
        print(f"Execution ID: {handle.id}")

        # Stream events and wait for the suspend
        print("\nWaiting for workflow to reach approval step...\n")

        async for event in events.stream_workflow(polos, handle.root_workflow_id, handle.id):
            if event.event_type and event.event_type.startswith("suspend_"):
                data = event.data if isinstance(event.data, dict) else {}
                approval_url = data.get("_approval_url")

                # The UI dev server runs on :5173 -- rewrite the URL for local development.
                # In production the orchestrator serves the UI, so the URL works as-is.
                ui_base_url = os.getenv("POLOS_UI_URL", "http://localhost:5173")
                step_key = event.event_type[len("suspend_"):]
                if approval_url:
                    display_url = approval_url.replace(api_url, ui_base_url)
                else:
                    display_url = f"{ui_base_url}/approve/{handle.id}/{step_key}"

                print("=" * 60)
                print("  Workflow suspended -- waiting for approval")
                print("=" * 60)
                print(f"\n  Open this URL in your browser:\n")
                print(f"  {display_url}\n")
                print("  Fill in the form and click Submit.")
                print("  The workflow will resume automatically.\n")
                print("  Waiting for response...")

        # Give the orchestrator a moment to finalize
        await asyncio.sleep(1)

        execution = await polos.get_execution(handle.id)

        print("\n" + "=" * 60)
        if execution.get("status") == "completed":
            result = execution.get("result", {})
            print("  Workflow completed!")
            print(f"  Service:     {result.get('service')}")
            print(f"  Version:     {result.get('version')}")
            print(f"  Environment: {result.get('environment')}")
            print(f"  Status:      {result.get('status')}")
            print(f"  Approved by: {result.get('approved_by') or result.get('approvedBy')}")
            if result.get("reason"):
                print(f"  Reason:      {result.get('reason')}")
        else:
            print(f"  Workflow ended with status: {execution.get('status')}")
            if execution.get("error"):
                print(f"  Error: {execution['error']}")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
