"""
Interactive demo for suspend/resume workflows.

Run with:
    python main.py
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos
from polos.features import events

from workflows import (
    approval_workflow,
    multi_step_form,
    document_review,
    ApprovalRequest,
    MultiStepFormPayload,
    DocumentReviewPayload,
)

load_dotenv()


def print_header(title: str):
    """Print a formatted header."""
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


def print_section(title: str):
    """Print a section divider."""
    print(f"\n--- {title} ---")


def get_user_choice(prompt: str, options: list[str]) -> int:
    """Get user choice from a list of options."""
    print(f"\n{prompt}")
    for i, option in enumerate(options, 1):
        print(f"  {i}. {option}")

    while True:
        try:
            choice = int(input("\nEnter your choice: "))
            if 1 <= choice <= len(options):
                return choice
        except ValueError:
            pass
        print(f"Please enter a number between 1 and {len(options)}")


def get_yes_no(prompt: str) -> bool:
    """Get a yes/no response from the user."""
    while True:
        response = input(f"{prompt} (y/n): ").strip().lower()
        if response in ("y", "yes"):
            return True
        if response in ("n", "no"):
            return False
        print("Please enter 'y' or 'n'")


async def run_approval_workflow(polos):
    """Run the approval workflow with interactive resume."""
    print_header("Approval Workflow Demo")

    print("\nEnter approval request details:")
    request_id = input("  Request ID [REQ-001]: ").strip() or "REQ-001"
    requester = input("  Requester email [alice@example.com]: ").strip() or "alice@example.com"
    description = input("  Description [Purchase new equipment]: ").strip() or "Purchase new equipment"
    amount_str = input("  Amount [1500.00]: ").strip() or "1500.00"
    amount = float(amount_str)

    payload = ApprovalRequest(
        request_id=request_id,
        requester=requester,
        description=description,
        amount=amount,
    )

    print_section("Starting workflow")
    print(f"Starting approval workflow for request: {request_id}")

    handle = await approval_workflow.invoke(polos, payload)
    print(f"Execution ID: {handle.id}")
    print("Workflow will suspend and wait for approval...")

    suspend_step_key = "await_approval"

    print(f"\nStreaming suspend events for workflow: {handle.root_workflow_id}")

    suspend_data = None
    async for event in events.stream_workflow(polos, handle.root_workflow_id, handle.id):
        if event.event_type.startswith("suspend_"):
            print("\nReceived suspend event!")
            suspend_data = event.data
            print(f"  Request ID: {suspend_data.get('request_id')}")
            print(f"  Requester: {suspend_data.get('requester')}")
            print(f"  Description: {suspend_data.get('description')}")
            print(f"  Amount: ${suspend_data.get('amount', 0):.2f}")
            print(f"  Message: {suspend_data.get('message')}")
            break

    if not suspend_data:
        print("Did not receive suspend event")
        return

    print_section("Enter Approval Decision")
    approved = get_yes_no("Do you approve this request?")
    approver = input("Your email [manager@example.com]: ").strip() or "manager@example.com"
    comments = input("Comments (optional): ").strip() or None

    print_section("Resuming workflow")
    resume_data = {
        "approved": approved,
        "approver": approver,
        "comments": comments,
    }

    await polos.resume(
        suspend_workflow_id=handle.root_workflow_id,
        suspend_execution_id=handle.id,
        suspend_step_key=suspend_step_key,
        data=resume_data,
    )
    print("Resume event published!")

    await asyncio.sleep(2)
    execution = await polos.get_execution(handle.id)

    if execution.get("status") == "completed":
        print_section("Workflow Completed")
        output = execution.get("result", {})
        print(f"  Status: {output.get('status')}")
        print(f"  Approved: {output.get('approved')}")
        print(f"  Approver: {output.get('approver')}")
        if output.get("comments"):
            print(f"  Comments: {output.get('comments')}")
    else:
        print(f"Final status: {execution.get('status')}")


async def run_multi_step_form(polos):
    """Run the multi-step form workflow with interactive resume."""
    print_header("Multi-Step Form Workflow Demo")

    form_id = input("\nForm ID [FORM-001]: ").strip() or "FORM-001"

    payload = MultiStepFormPayload(form_id=form_id)

    print_section("Starting workflow")
    print(f"Starting multi-step form: {form_id}")

    handle = await multi_step_form.invoke(polos, payload)
    print(f"Execution ID: {handle.id}")

    steps = [
        ("personal_info", "Personal Information", ["first_name", "last_name", "email"]),
        ("address_info", "Address Information", ["street", "city", "country"]),
        ("preferences", "Preferences", ["newsletter", "notifications"]),
    ]

    for step_key, step_name, fields in steps:
        print(f"\nWaiting for step: {step_name}")

        async for event in events.stream_workflow(polos, handle.root_workflow_id, handle.id):
            if event.event_type.startswith("suspend_"):
                suspend_data = event.data
                print(f"\n  Step {suspend_data.get('step')} of {suspend_data.get('total_steps')}")
                print(f"  {suspend_data.get('prompt')}")
                break

        if step_key == "personal_info":
            print("\nEnter personal information:")
            resume_data = {
                "first_name": input("  First name [John]: ").strip() or "John",
                "last_name": input("  Last name [Doe]: ").strip() or "Doe",
                "email": input("  Email [john.doe@example.com]: ").strip() or "john.doe@example.com",
            }
        elif step_key == "address_info":
            print("\nEnter address information:")
            resume_data = {
                "street": input("  Street [123 Main St]: ").strip() or "123 Main St",
                "city": input("  City [San Francisco]: ").strip() or "San Francisco",
                "country": input("  Country [USA]: ").strip() or "USA",
            }
        elif step_key == "preferences":
            print("\nEnter preferences:")
            resume_data = {
                "newsletter": get_yes_no("  Subscribe to newsletter?"),
                "notifications": get_yes_no("  Enable notifications?"),
            }
        else:
            resume_data = {}

        print(f"\nSubmitting {step_name}...")
        await polos.resume(
            suspend_workflow_id=handle.root_workflow_id,
            suspend_execution_id=handle.id,
            suspend_step_key=step_key,
            data=resume_data,
        )
        print("Resume event published!")

    await asyncio.sleep(2)
    execution = await polos.get_execution(handle.id)

    if execution.get("status") == "completed":
        print_section("Form Completed")
        output = execution.get("result", {})
        print(f"  Form ID: {output.get('form_id')}")
        print(f"  Status: {output.get('status')}")
        print(f"  Fields collected: {output.get('fields_count')}")

        if output.get("personal_info"):
            pi = output["personal_info"]
            print(f"\n  Personal Info:")
            print(f"    Name: {pi.get('first_name')} {pi.get('last_name')}")
            print(f"    Email: {pi.get('email')}")

        if output.get("address_info"):
            ai = output["address_info"]
            print(f"\n  Address:")
            print(f"    {ai.get('street')}, {ai.get('city')}, {ai.get('country')}")

        if output.get("preferences"):
            pref = output["preferences"]
            print(f"\n  Preferences:")
            print(f"    Newsletter: {pref.get('newsletter')}")
            print(f"    Notifications: {pref.get('notifications')}")
    else:
        print(f"Final status: {execution.get('status')}")


async def run_document_review(polos):
    """Run the document review workflow with interactive resume."""
    print_header("Document Review Workflow Demo")

    print("\nEnter document details:")
    document_id = input("  Document ID [DOC-001]: ").strip() or "DOC-001"
    document_title = input("  Document title [Q4 Report]: ").strip() or "Q4 Report"
    reviewers_input = input("  Reviewers (comma-separated) [alice,bob]: ").strip()
    reviewers = [r.strip() for r in (reviewers_input or "alice,bob").split(",")]

    payload = DocumentReviewPayload(
        document_id=document_id,
        document_title=document_title,
        reviewers=reviewers,
    )

    print_section("Starting workflow")
    print(f"Starting document review for: {document_title}")
    print(f"Reviewers: {', '.join(reviewers)}")

    handle = await document_review.invoke(polos, payload)
    print(f"Execution ID: {handle.id}")

    for i, reviewer in enumerate(reviewers):
        suspend_step_key = f"review_{i}_{reviewer}"

        print(f"\nWaiting for reviewer: {reviewer}")

        async for event in events.stream_workflow(polos, handle.root_workflow_id, handle.id):
            if event.event_type.startswith("suspend_"):
                suspend_data = event.data
                print(f"\n  Reviewer {suspend_data.get('reviewer_number')} of {suspend_data.get('total_reviewers')}")
                print(f"  Document: {suspend_data.get('document_title')}")
                print(f"  {suspend_data.get('prompt')}")
                break

        print(f"\n[Acting as {reviewer}]")
        approved = get_yes_no(f"  Does {reviewer} approve?")
        comments = input("  Comments (optional): ").strip() or None
        rating_str = input("  Rating (1-5) [4]: ").strip() or "4"
        rating = int(rating_str)

        resume_data = {
            "approved": approved,
            "comments": comments,
            "rating": rating,
        }

        print(f"\nSubmitting {reviewer}'s review...")
        await polos.resume(
            suspend_workflow_id=handle.root_workflow_id,
            suspend_execution_id=handle.id,
            suspend_step_key=suspend_step_key,
            data=resume_data,
        )
        print("Resume event published!")

    await asyncio.sleep(2)
    execution = await polos.get_execution(handle.id)

    if execution.get("status") == "completed":
        print_section("Review Completed")
        output = execution.get("result", {})
        print(f"  Document: {output.get('document_title')}")
        print(f"  Status: {output.get('status')}")
        print(f"  All Approved: {output.get('all_approved')}")

        print("\n  Reviews:")
        for review in output.get("reviews", []):
            feedback = review.get("feedback", {})
            status_icon = "[OK]" if feedback.get("approved") else "[X]"
            print(f"    {status_icon} {review.get('reviewer')}: rating={feedback.get('rating')}")
            if feedback.get("comments"):
                print(f"        Comments: {feedback.get('comments')}")
    else:
        print(f"Final status: {execution.get('status')}")


async def main():
    """Main entry point."""
    print_header("Suspend/Resume Workflow Demo")
    print("\nThis demo shows how workflows can pause for user input and resume.")

    async with Polos(log_file="polos.log") as polos:
        while True:
            choice = get_user_choice(
                "Select a workflow to run:",
                [
                    "Approval Workflow - Single approval with suspend/resume",
                    "Multi-Step Form - Collect data across 3 steps",
                    "Document Review - Multiple reviewers in sequence",
                    "Exit",
                ],
            )

            try:
                if choice == 1:
                    await run_approval_workflow(polos)
                elif choice == 2:
                    await run_multi_step_form(polos)
                elif choice == 3:
                    await run_document_review(polos)
                elif choice == 4:
                    print("\nGoodbye!")
                    break
            except Exception as e:
                print(f"\nError: {e}")
                import traceback
                traceback.print_exc()

            print("\n" + "-" * 60)


if __name__ == "__main__":
    asyncio.run(main())
