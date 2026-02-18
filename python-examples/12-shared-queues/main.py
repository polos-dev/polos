"""
Demonstrate shared queues for concurrency control.

Run with:
    python main.py
"""

import asyncio
import time

from dotenv import load_dotenv
from polos import Polos

from workflows import (
    api_call_workflow,
    db_read_workflow,
    db_write_workflow,
    heavy_processing_workflow,
    inline_queue_workflow,
    named_queue_workflow,
    batch_processor,
    queue_orchestrator,
    slow_workflow,
    ApiPayload,
    SlowWorkflowPayload,
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


async def demo_api_queue(polos):
    """Demonstrate API queue with concurrency limit of 5."""
    print_header("API Queue Demo")
    print("The api-calls queue limits concurrent API requests to 5.")
    print("Invoking multiple API call workflows...")

    print_section("Single API call")
    result = await api_call_workflow.run(
        polos,
        ApiPayload(url="https://api.example.com/users", method="GET"),
    )
    print(f"  URL: {result['url']}")
    print(f"  Method: {result['method']}")
    print(f"  Status: {result['result']['status']}")

    print_section("Multiple API calls (queued by concurrency limit)")
    urls = [
        "https://api.example.com/users/1",
        "https://api.example.com/users/2",
        "https://api.example.com/users/3",
    ]

    handles = []
    for url in urls:
        handle = await api_call_workflow.invoke(
            polos,
            ApiPayload(url=url, method="GET"),
        )
        handles.append(handle)
        print(f"  Invoked: {url} (execution: {handle.id})")

    print(f"\n  {len(handles)} workflows queued on api-calls queue")


async def demo_db_queue(polos):
    """Demonstrate database queue shared between read and write."""
    print_header("Database Queue Demo")
    print("The database-ops queue is shared between db_read and db_write.")
    print("Total concurrent DB operations limited to 10.")

    print_section("Database read")
    result = await db_read_workflow.run(
        polos,
        {"table": "users", "query": {"active": True}},
    )
    print(f"  Table: {result['table']}")
    print(f"  Results: {result['results']}")

    print_section("Database write")
    result = await db_write_workflow.run(
        polos,
        {"table": "users", "data": {"name": "John Doe", "email": "john@example.com"}},
    )
    print(f"  Table: {result['table']}")
    print(f"  Inserted: {result['inserted']}")

    print_section("Mixed read/write operations (shared queue)")
    read_handle = await db_read_workflow.invoke(polos, {"table": "orders"})
    write_handle = await db_write_workflow.invoke(
        polos, {"table": "orders", "data": {"product": "Widget"}}
    )
    print(f"  Read execution: {read_handle.id[:8]}...")
    print(f"  Write execution: {write_handle.id[:8]}...")
    print("  Both share the database-ops queue (limit: 10)")


async def demo_heavy_queue(polos):
    """Demonstrate heavy processing queue with low concurrency."""
    print_header("Heavy Processing Queue Demo")
    print("The heavy-processing queue has low concurrency (2) for CPU-intensive work.")

    print_section("Heavy processing task")
    result = await heavy_processing_workflow.run(
        polos,
        {"data": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},
    )
    print(f"  Items processed: {result['processed']['items_processed']}")
    print(f"  Status: {result['processed']['status']}")

    print_section("Multiple heavy tasks (only 2 concurrent)")
    for i in range(3):
        handle = await heavy_processing_workflow.invoke(
            polos,
            {"data": list(range(i * 10, (i + 1) * 10))},
        )
        print(f"  Task {i+1} invoked: {handle.id[:8]}...")

    print("  Only 2 will run concurrently, 1 will wait in queue")


async def demo_inline_and_named_queues(polos):
    """Demonstrate inline and named queue configurations."""
    print_header("Inline and Named Queues Demo")

    print_section("Inline queue configuration")
    print("Workflow uses inline config: queue={'concurrency_limit': 3}")
    result = await inline_queue_workflow.run(polos, {})
    print(f"  Result: {result['message']}")

    print_section("Named queue configuration")
    print("Workflow uses string queue name: queue='my-named-queue'")
    result = await named_queue_workflow.run(polos, {})
    print(f"  Result: {result['message']}")


async def demo_batch_processor(polos):
    """Demonstrate batch processor sharing API queue."""
    print_header("Batch Processor Demo")
    print("The batch_processor shares the api-calls queue with api_call_workflow.")
    print("This ensures total API calls are limited across both workflows.")

    print_section("Processing batch of items")
    items = [
        {"url": "https://api.example.com/item/1"},
        {"url": "https://api.example.com/item/2"},
        {"url": "https://api.example.com/item/3"},
    ]

    result = await batch_processor.run(polos, {"items": items})
    print(f"  Items processed: {result['processed']}")
    print(f"  All items share the api-calls queue (limit: 5)")


async def demo_queue_orchestrator(polos):
    """Demonstrate orchestrator invoking workflows on different queues."""
    print_header("Queue Orchestrator Demo")
    print("The orchestrator invokes workflows that use different queues.")
    print("Each queue throttles its workflows independently.")

    print_section("Invoking workflows on different queues")
    result = await queue_orchestrator.run(polos, {})

    print(f"  API workflow (api-calls queue): {result['api_execution_id'][:8]}...")
    print(f"  DB workflow (database-ops queue): {result['db_execution_id'][:8]}...")
    print(f"  Heavy workflow (heavy-processing queue): {result['heavy_execution_id'][:8]}...")
    print("\n  Each workflow is throttled by its own queue's concurrency limit")


async def demo_runtime_concurrency(polos):
    """Demonstrate setting queue concurrency at runtime."""
    print_header("Runtime Queue Concurrency Demo")
    print("This demo shows how to set queue concurrency at invocation time.")
    print("Each workflow sleeps for 2 seconds and prints when it starts/completes.")

    num_workflows = 3
    sleep_seconds = 2.0

    # Demo 1: Concurrency = 1 (sequential execution)
    print_section("Concurrency = 1 (Sequential Execution)")
    print(f"Invoking {num_workflows} workflows with queue_concurrency_limit=1")
    print("Workflows will execute ONE AT A TIME (sequentially).")
    print(f"Expected time: ~{num_workflows * sleep_seconds:.0f} seconds\n")

    start_time = time.time()

    handles = []
    for i in range(num_workflows):
        handle = await polos.invoke(
            workflow_id="slow_workflow",
            payload={"workflow_id": i + 1, "sleep_seconds": sleep_seconds},
            queue_name="sequential-demo-queue",
            queue_concurrency_limit=1,
        )
        handles.append(handle)
        print(f"  Invoked workflow {i + 1}: {handle.id}")

    print("\nWaiting for all workflows to complete...")

    for handle in handles:
        while True:
            execution = await polos.get_execution(handle.id)
            if execution.get("status") in ["completed", "failed"]:
                break
            await asyncio.sleep(0.5)

    elapsed = time.time() - start_time
    print(f"\n  All workflows completed in {elapsed:.1f} seconds")
    print(f"  (Sequential: workflows ran one after another)")

    # Demo 2: Concurrency = 3 (parallel execution)
    print_section("Concurrency = 3 (Parallel Execution)")
    print(f"Invoking {num_workflows} workflows with queue_concurrency_limit=3")
    print("All workflows will start AT THE SAME TIME (parallel).")
    print(f"Expected time: ~{sleep_seconds:.0f} seconds\n")

    start_time = time.time()

    handles = []
    for i in range(num_workflows):
        handle = await polos.invoke(
            workflow_id="slow_workflow",
            payload={"workflow_id": i + 10, "sleep_seconds": sleep_seconds},
            queue_name="parallel-demo-queue",
            queue_concurrency_limit=3,
        )
        handles.append(handle)
        print(f"  Invoked workflow {i + 10}: {handle.id}")

    print("\nWaiting for all workflows to complete...")

    for handle in handles:
        while True:
            execution = await polos.get_execution(handle.id)
            if execution.get("status") in ["completed", "failed"]:
                break
            await asyncio.sleep(0.5)

    elapsed = time.time() - start_time
    print(f"\n  All workflows completed in {elapsed:.1f} seconds")
    print(f"  (Parallel: all workflows ran simultaneously)")


async def main():
    """Run all shared queues demos."""
    print("=" * 60)
    print("Shared Queues Workflow Examples")
    print("=" * 60)
    print("\nQueues defined in this example:")
    print("  - api-calls: concurrency_limit=5 (for API requests)")
    print("  - database-ops: concurrency_limit=10 (for DB operations)")
    print("  - heavy-processing: concurrency_limit=2 (for CPU-intensive work)")

    async with Polos(log_file="polos.log") as polos:
        try:
            await demo_api_queue(polos)
            await demo_db_queue(polos)
            await demo_heavy_queue(polos)
            await demo_inline_and_named_queues(polos)
            await demo_batch_processor(polos)
            await demo_queue_orchestrator(polos)
            await demo_runtime_concurrency(polos)

            print("\n" + "=" * 60)
            print("All demos completed!")
            print("=" * 60)

        except Exception as e:
            print(f"\nError: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
