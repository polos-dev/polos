# Parallel Review Example

This example demonstrates how to run multiple workflows in parallel and aggregate results.

## Features

- Parallel workflow execution with `batch_invoke_and_wait`
- Fire-and-forget pattern with `batch_invoke`
- Fan-out/fan-in patterns
- Result aggregation

## Use Cases

- Multi-reviewer document approval
- Parallel data processing
- Scatter-gather patterns
- Background job launching

## Files

- `workflows.py` - Workflow definitions
- `worker.py` - Worker that registers workflows

## Running the Example

1. Start the Polos server:
   ```bash
   polos-server start
   ```

2. Install dependencies:
   ```bash
   # Using uv (recommended)
   uv sync

   # Or using pip
   pip install -e .
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

4. Run the worker:
   ```bash
   python worker.py
   ```

## Parallel Execution Patterns

### Batch Invoke and Wait

Run multiple workflows in parallel and wait for all to complete:

```python
from polos.types.types import BatchWorkflowInput

# Create batch of workflow requests
requests = [
    BatchWorkflowInput(id="review", payload={"reviewer": "alice"}),
    BatchWorkflowInput(id="review", payload={"reviewer": "bob"}),
    BatchWorkflowInput(id="review", payload={"reviewer": "charlie"}),
]

# Run all in parallel and wait for results
results = await ctx.step.batch_invoke_and_wait("parallel_reviews", requests)

# Aggregate results
for result in results:
    if result.success:
        process(result.result)
```

### Fire and Forget

Launch workflows without waiting for results:

```python
requests = [
    BatchWorkflowInput(id="task", payload={"id": 1}),
    BatchWorkflowInput(id="task", payload={"id": 2}),
]

# Launch all workflows (non-blocking)
handles = await ctx.step.batch_invoke("launch_tasks", requests)

# Return immediately with execution IDs for tracking
return {"launched": [h.execution_id for h in handles]}
```

### Single Workflow Invoke

Invoke a single workflow and wait:

```python
# Invoke and wait for result
result = await ctx.step.invoke_and_wait(
    "invoke_child",
    child_workflow,
    {"data": "value"},
)

# Or invoke without waiting
handle = await ctx.step.invoke(
    "invoke_child",
    child_workflow,
    {"data": "value"},
)
```

## BatchStepResult

Results from `batch_invoke_and_wait` are `BatchStepResult` objects:

```python
class BatchStepResult:
    workflow_id: str
    execution_id: str
    success: bool
    result: Any | None  # Workflow return value
    error: str | None   # Error message if failed
```

## Fan-Out/Fan-In Pattern

1. **Fan-out**: Split work into parallel tasks
2. **Execute**: Run all tasks concurrently
3. **Fan-in**: Aggregate results

```python
@workflow(id="data_processor")
async def data_processor(ctx, payload):
    data = payload["data"]

    # Fan-out: Split into chunks
    chunks = [data[i:i+10] for i in range(0, len(data), 10)]

    requests = [
        BatchWorkflowInput(id="process_chunk", payload={"chunk": c})
        for c in chunks
    ]

    # Execute in parallel
    results = await ctx.step.batch_invoke_and_wait("parallel", requests)

    # Fan-in: Aggregate results
    all_processed = []
    for r in results:
        if r.success:
            all_processed.extend(r.result["items"])

    return {"processed": all_processed}
```

## Best Practices

1. **Limit parallelism** - Use queues to control concurrent executions
2. **Handle failures** - Check `result.success` before accessing `result.result`
3. **Use typed payloads** - Pydantic models for better validation
4. **Aggregate carefully** - Handle partial failures gracefully
