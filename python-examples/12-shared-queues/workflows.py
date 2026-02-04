"""Shared queue examples.

Demonstrates how to use queues to control concurrency across workflows.
Queues limit how many workflows can run simultaneously, preventing
resource exhaustion and rate limiting issues.
"""

import asyncio
from pydantic import BaseModel

from polos import workflow, WorkflowContext, queue


# Define shared queues
# These queues can be used across multiple workflows

# Queue for API calls - limit to 5 concurrent requests
api_queue = queue("api-calls", concurrency_limit=5)

# Queue for database operations - limit to 10 concurrent
db_queue = queue("database-ops", concurrency_limit=10)

# Queue for heavy processing - limit to 2 concurrent
heavy_queue = queue("heavy-processing", concurrency_limit=2)

# Unlimited queue (workflows run as fast as possible)
unlimited_queue = queue("unlimited")


class ApiPayload(BaseModel):
    """Payload for API call workflow."""

    url: str
    method: str = "GET"
    data: dict | None = None


@workflow(id="api_call", queue=api_queue)
async def api_call_workflow(ctx: WorkflowContext, payload: ApiPayload) -> dict:
    """Workflow that makes API calls.

    Uses the api-calls queue to limit concurrent API requests.
    This prevents overwhelming external APIs with too many requests.
    """
    result = await ctx.step.run(
        "make_request",
        make_api_request,
        payload.url,
        payload.method,
        payload.data,
    )

    return {
        "url": payload.url,
        "method": payload.method,
        "result": result,
    }


def make_api_request(url: str, method: str, data: dict | None) -> dict:
    """Simulate an API request."""
    # In a real scenario, this would make an HTTP request
    return {"status": 200, "response": {"message": "Success"}}


@workflow(id="db_read", queue=db_queue)
async def db_read_workflow(ctx: WorkflowContext, payload: dict) -> dict:
    """Database read operation.

    Uses the database-ops queue to limit concurrent database connections.
    """
    table = payload.get("table", "users")
    query = payload.get("query", {})

    result = await ctx.step.run(
        "execute_query",
        execute_db_query,
        table,
        query,
    )

    return {"table": table, "results": result}


@workflow(id="db_write", queue=db_queue)
async def db_write_workflow(ctx: WorkflowContext, payload: dict) -> dict:
    """Database write operation.

    Shares the database-ops queue with db_read to limit total DB connections.
    """
    table = payload.get("table", "users")
    data = payload.get("data", {})

    result = await ctx.step.run(
        "insert_data",
        insert_db_data,
        table,
        data,
    )

    return {"table": table, "inserted": result}


def execute_db_query(table: str, query: dict) -> list:
    """Simulate a database query."""
    return [{"id": 1, "name": "Example"}]


def insert_db_data(table: str, data: dict) -> dict:
    """Simulate a database insert."""
    return {"id": 1, **data}


@workflow(id="heavy_processing", queue=heavy_queue)
async def heavy_processing_workflow(ctx: WorkflowContext, payload: dict) -> dict:
    """CPU-intensive processing workflow.

    Uses the heavy-processing queue with low concurrency to prevent
    resource exhaustion on compute-intensive tasks.
    """
    data = payload.get("data", [])

    # Simulate heavy processing
    result = await ctx.step.run(
        "process_data",
        heavy_process,
        data,
    )

    return {"processed": result}


def heavy_process(data: list) -> dict:
    """Simulate heavy processing."""
    # In a real scenario, this would do CPU-intensive work
    return {"items_processed": len(data), "status": "complete"}


# Inline queue configuration (alternative to queue objects)
@workflow(id="inline_queue_workflow", queue={"concurrency_limit": 3})
async def inline_queue_workflow(ctx: WorkflowContext, payload: dict) -> dict:
    """Workflow with inline queue configuration.

    Uses the workflow ID as the queue name with custom concurrency.
    """
    return {"message": "Processed with inline queue"}


# Queue by name only (uses default concurrency from environment)
@workflow(id="named_queue_workflow", queue="my-named-queue")
async def named_queue_workflow(ctx: WorkflowContext, payload: dict) -> dict:
    """Workflow with named queue.

    Uses a string queue name with default concurrency settings.
    """
    return {"message": "Processed with named queue"}


@workflow(id="batch_processor", queue=api_queue)
async def batch_processor(ctx: WorkflowContext, payload: dict) -> dict:
    """Process a batch of items using the API queue.

    Even though this is a single workflow, it shares the api-calls queue
    with api_call_workflow, so total concurrent API calls are limited.
    """
    items = payload.get("items", [])
    results = []

    for i, item in enumerate(items):
        result = await ctx.step.run(
            f"process_item_{i}",
            make_api_request,
            item.get("url", ""),
            "GET",
            None,
        )
        results.append(result)

    return {"processed": len(results), "results": results}


@workflow(id="queue_orchestrator")
async def queue_orchestrator(ctx: WorkflowContext, payload: dict) -> dict:
    """Orchestrator that invokes workflows on different queues.

    Demonstrates how queues isolate different types of work.
    """
    # Invoke workflows on different queues
    # They will be throttled by their respective queue limits

    api_handle = await ctx.step.invoke(
        "invoke_api",
        api_call_workflow,
        ApiPayload(url="https://api.example.com/data"),
    )

    db_handle = await ctx.step.invoke(
        "invoke_db",
        db_read_workflow,
        {"table": "users", "query": {"active": True}},
    )

    heavy_handle = await ctx.step.invoke(
        "invoke_heavy",
        heavy_processing_workflow,
        {"data": [1, 2, 3, 4, 5]},
    )

    return {
        "api_execution_id": api_handle.id,
        "db_execution_id": db_handle.id,
        "heavy_execution_id": heavy_handle.id,
    }


class SlowWorkflowPayload(BaseModel):
    """Payload for slow workflow demo."""

    workflow_id: int
    sleep_seconds: float = 2.0


class SlowWorkflowResult(BaseModel):
    """Result from slow workflow."""

    workflow_id: int
    message: str


@workflow(id="slow_workflow")
async def slow_workflow(ctx: WorkflowContext, payload: SlowWorkflowPayload) -> SlowWorkflowResult:
    """Workflow that sleeps to demonstrate queue concurrency.

    Prints when it starts and completes to show execution order.
    """
    print(f"  [Workflow {payload.workflow_id}] Started!")

    # Sleep to simulate work
    await asyncio.sleep(payload.sleep_seconds)

    print(f"  [Workflow {payload.workflow_id}] Completed!")

    return SlowWorkflowResult(
        workflow_id=payload.workflow_id,
        message=f"Workflow {payload.workflow_id} finished after {payload.sleep_seconds}s",
    )
