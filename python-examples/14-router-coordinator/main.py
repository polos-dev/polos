"""
Client demonstrating the Blog Review workflow with agent orchestration.

Run the worker first:
    python worker.py

Then run this client:
    python main.py
"""

import asyncio
import os
import json

from dotenv import load_dotenv
from polos import PolosClient, events

from workflows import generate_blog, GenerateBlogPayload

load_dotenv()


def print_header(title: str):
    """Print a formatted header."""
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


def print_section(title: str):
    """Print a section divider."""
    print(f"\n--- {title} ---")


async def demo_generate_blog(client: PolosClient):
    """Demonstrate the generate_blog workflow with event streaming."""
    print_header("Generate Blog Demo")
    print("This workflow:")
    print("  1. Generates a blog post using the blog_generator agent")
    print("  2. Sends the draft through blog_review workflow which:")
    print("     - Runs 3 review agents in parallel (grammar, tone, correctness)")
    print("     - Calls final_editor agent to produce polished version")

    topic = "The benefits of taking short breaks during work"
    additional_instructions = "Keep it casual and relatable. Include practical tips."

    print_section("Invoking generate_blog workflow")
    print(f"  Topic: {topic}")
    print(f"  Instructions: {additional_instructions}")

    # Invoke the workflow
    handle = await generate_blog.invoke(
        client,
        GenerateBlogPayload(
            topic=topic,
            additional_instructions=additional_instructions,
        ),
    )

    print(f"\n  Workflow started with execution ID: {handle.id}")
    print("\n  Streaming events...")
    print("-" * 60)

    # Stream workflow events and print agent_finish and workflow_finish events
    async for event in events.stream_workflow(client, handle.root_workflow_id, handle.id):
        event_type = event.event_type

        if event_type == "agent_finish":
            agent_id = event.data.get("_metadata", {}).get("workflow_id", "unknown")
            output = event.data.get("result")
            print(f"\n[AGENT FINISH] {agent_id}")
            print(f"  Output: {json.dumps(output, indent=2)}")

        elif event_type == "workflow_finish":
            workflow_id = event.data.get("_metadata", {}).get("workflow_id", "unknown")
            print(f"\n[WORKFLOW FINISH] {workflow_id}")
            result = event.data.get("result", {})
            print(f"  Result: {json.dumps(result, indent=2)}")

        elif event_type == "step_start":
            step_name = event.data.get("step_key", "unknown")
            print(f"\n[STEP START] {step_name}")

        elif event_type == "step_finish":
            step_name = event.data.get("step_key", "unknown")
            print(f"\n[STEP FINISH] {step_name}")


async def demo_blog_review_only(client: PolosClient):
    """Demonstrate the blog_review workflow directly."""
    from workflows import blog_review, BlogReviewPayload

    print_header("Blog Review Only Demo")
    print("This workflow reviews existing text through:")
    print("  1. Grammar reviewer (parallel)")
    print("  2. Tone reviewer (parallel)")
    print("  3. Correctness reviewer (parallel)")
    print("  4. Final editor (aggregates feedback)")

    sample_text = """
    Artficial Inteligence is revolutionizing how we work. Many companys are adopting AI tools
    to boost productivity. Studies show that AI can increase efficiency by over 500%!

    However, its important to remember that AI is just a tool. It works best when humans
    and machines collaborate together. The future of work is'nt about replacing humans,
    its about augmenting our capabilties.
    """

    print_section("Invoking blog_review workflow")
    print("  Text: (contains intentional errors for demonstration)")

    # Invoke the workflow
    handle = await blog_review.invoke(
        client,
        BlogReviewPayload(text=sample_text.strip()),
    )

    print(f"\n  Workflow started with execution ID: {handle.id}")
    print("\n  Streaming events...")
    print("-" * 60)

    # Stream workflow events
    async for event in events.stream_workflow(client, handle.root_workflow_id, handle.id):
        event_type = event.event_type

        if event_type == "agent_finish":
            agent_id = event.data.get("_metadata", {}).get("workflow_id", "unknown")
            output = event.data.get("result", {})
            print(f"\n[AGENT FINISH] {agent_id}")
            print(f"  Output: {json.dumps(output, indent=2)}")

        elif event_type == "workflow_finish":
            workflow_id = event.data.get("_metadata", {}).get("workflow_id", "unknown")
            print(f"\n[WORKFLOW FINISH] {workflow_id}")
            print(f"  Result: {json.dumps(event.data.get('result', {}), indent=2)}")


async def main():
    """Run blog review demos."""
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Get it from the Polos UI at http://localhost:5173/projects/settings"
        )

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    print("=" * 60)
    print("Blog Review Workflow Examples")
    print("=" * 60)
    print("\nMake sure the worker is running: python worker.py")
    print("\nThis demo showcases agent orchestration patterns:")
    print("  1. Generate blog - creates and reviews a blog post")
    print("  2. Blog review only - reviews existing text")

    try:
        # Demo 1: Generate and review a blog
        await demo_generate_blog(client)

        # Demo 2: Review existing text
        await demo_blog_review_only(client)

        print("\n" + "=" * 60)
        print("All demos completed!")
        print("=" * 60)

    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        print("\nMake sure the worker is running and try again.")


if __name__ == "__main__":
    asyncio.run(main())
