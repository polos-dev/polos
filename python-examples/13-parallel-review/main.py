"""
Client demonstrating parallel workflow execution patterns.

Run the worker first:
    python worker.py

Then run this client:
    python main.py
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient

from workflows import (
    single_review,
    parallel_review,
    data_chunk_processor,
    fire_and_forget_batch,
    ReviewRequest,
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


async def demo_single_review(client: PolosClient):
    """Demonstrate a single review workflow."""
    print_header("Single Review Demo")
    print("This workflow processes a single document review.")

    print_section("Running single review")
    result = await single_review.run(
        client,
        ReviewRequest(
            reviewer_id="alice",
            document_id="DOC-001",
            content="This is a sample document for review. It contains important information.",
        ),
    )

    print(f"  Reviewer: {result.reviewer_id}")
    print(f"  Document: {result.document_id}")
    print(f"  Approved: {result.approved}")
    print(f"  Score: {result.score}/10")
    print(f"  Comments: {result.comments}")


async def demo_parallel_review(client: PolosClient):
    """Demonstrate parallel review workflow with multiple reviewers."""
    print_header("Parallel Review Demo")
    print("This workflow runs multiple reviews in parallel and aggregates results.")
    print("Uses batch_invoke_and_wait to run all reviews concurrently.")

    print_section("Submitting document for parallel review")
    reviewers = ["alice", "bob", "charlie", "diana"]
    print(f"  Document: DOC-002")
    print(f"  Reviewers: {', '.join(reviewers)}")

    result = await parallel_review.run(
        client,
        {
            "document_id": "DOC-002",
            "content": "This is an important proposal document that requires multiple approvals.",
            "reviewers": reviewers,
        },
    )

    print_section("Aggregated Results")
    print(f"  Document ID: {result.document_id}")
    print(f"  Total Reviews: {result.total_reviews}")
    print(f"  Approved Count: {result.approved_count}/{result.total_reviews}")
    print(f"  Average Score: {result.average_score:.1f}/10")
    print(f"  All Approved: {result.all_approved}")

    print("\n  Individual Reviews:")
    for review in result.reviews:
        status = "[OK]" if review["approved"] else "[X]"
        print(f"    {status} {review['reviewer_id']}: score={review['score']}")


async def demo_data_chunk_processor(client: PolosClient):
    """Demonstrate parallel data chunk processing."""
    print_header("Data Chunk Processor Demo")
    print("This workflow splits data into chunks and processes them in parallel.")
    print("Demonstrates fan-out/fan-in pattern for data processing.")

    # Create sample data
    data = [f"item_{i}" for i in range(25)]
    chunk_size = 10

    print_section("Processing data in parallel chunks")
    print(f"  Total items: {len(data)}")
    print(f"  Chunk size: {chunk_size}")
    print(f"  Number of chunks: {(len(data) + chunk_size - 1) // chunk_size}")

    result = await data_chunk_processor.run(
        client,
        {
            "data": data,
            "chunk_size": chunk_size,
        },
    )

    print_section("Processing Results")
    print(f"  Total items: {result['total_items']}")
    print(f"  Chunks processed: {result['chunks_processed']}")
    print(f"  Items processed: {result['processed_items']}")
    print(f"\n  Sample results (first 5):")
    for item in result['results'][:5]:
        print(f"    - {item}")


async def demo_fire_and_forget(client: PolosClient):
    """Demonstrate fire-and-forget batch workflow."""
    print_header("Fire and Forget Batch Demo")
    print("This workflow launches multiple background tasks without waiting.")
    print("Returns execution IDs for tracking, but doesn't block on completion.")

    # Create sample tasks
    tasks = [
        {"id": f"task-{i}", "data": {"value": i * 10}}
        for i in range(5)
    ]

    print_section("Launching background tasks")
    print(f"  Tasks to launch: {len(tasks)}")

    result = await fire_and_forget_batch.run(
        client,
        {"tasks": tasks},
    )

    print_section("Launch Results")
    print(f"  Tasks launched: {result['launched']}")
    print(f"\n  Execution IDs (for tracking):")
    for exec_id in result['execution_ids']:
        print(f"    - {exec_id}")

    print("\n  Note: These tasks are running in the background.")
    print("  Use the execution IDs to check their status later.")


async def demo_parallel_comparison(client: PolosClient):
    """Compare sequential vs parallel execution time."""
    print_header("Parallel vs Sequential Comparison")
    print("This demo shows the time savings of parallel execution.")

    import time

    # Sequential: Run 3 reviews one by one
    print_section("Sequential Execution (3 reviews)")
    start = time.time()

    for i, reviewer in enumerate(["reviewer1", "reviewer2", "reviewer3"]):
        await single_review.run(
            client,
            ReviewRequest(
                reviewer_id=reviewer,
                document_id="DOC-SEQ",
                content="Sequential test document",
            ),
        )
        print(f"  Completed review {i + 1}")

    sequential_time = time.time() - start
    print(f"\n  Sequential time: {sequential_time:.2f} seconds")

    # Parallel: Run 3 reviews at once
    print_section("Parallel Execution (3 reviews)")
    start = time.time()

    result = await parallel_review.run(
        client,
        {
            "document_id": "DOC-PAR",
            "content": "Parallel test document",
            "reviewers": ["reviewer1", "reviewer2", "reviewer3"],
        },
    )
    print(f"  Completed all {result.total_reviews} reviews")

    parallel_time = time.time() - start
    print(f"\n  Parallel time: {parallel_time:.2f} seconds")

    if sequential_time > 0:
        speedup = sequential_time / parallel_time if parallel_time > 0 else 0
        print(f"\n  Speedup: {speedup:.1f}x faster with parallel execution")


async def main():
    """Run all parallel review demos."""
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
    print("Parallel Review Workflow Examples")
    print("=" * 60)
    print("\nMake sure the worker is running: python worker.py")
    print("\nThis demo showcases parallel workflow patterns:")
    print("  1. Single review workflow")
    print("  2. Parallel multi-reviewer workflow (batch_invoke_and_wait)")
    print("  3. Data chunk processing (fan-out/fan-in)")
    print("  4. Fire-and-forget batch (batch_invoke)")
    print("  5. Sequential vs parallel comparison")

    try:
        await demo_single_review(client)
        await demo_parallel_review(client)
        await demo_data_chunk_processor(client)
        await demo_fire_and_forget(client)
        await demo_parallel_comparison(client)

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
