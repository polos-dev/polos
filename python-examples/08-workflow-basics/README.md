# Workflow Basics Example

This example demonstrates the fundamentals of Polos workflows - durable functions with automatic retry and state management.

## Features

- Creating workflows with the `@workflow` decorator
- Using Pydantic models for typed input/output
- Using `ctx.step.run()` for durable step execution
- Automatic retry with exponential backoff
- Deterministic operations (`uuid`, `now`, `random`)
- Time-based waiting with `wait_for`
- Child workflow invocation with `ctx.step.invoke_and_wait()`

## What are Workflows?

Workflows are functions decorated with `@workflow` that provide:

| Feature | Description |
|---------|-------------|
| **Durability** | Steps are automatically saved and replayed on resume |
| **Retry** | Failed steps are retried with exponential backoff |
| **Determinism** | Random values, UUIDs, timestamps are consistent on replay |
| **Composition** | Workflows can invoke other workflows |

## Files

- `workflows.py` - Workflow definitions with Pydantic models
- `worker.py` - Worker that registers workflows
- `main.py` - Demo script that runs workflows

## Running the Example

1. Start the Polos server:
   ```bash
   polos server start
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

4. Run the worker in one terminal:
   ```bash
   python worker.py
   ```

5. Run the demo in another terminal:
   ```bash
   python main.py
   ```

## Workflow Examples

### Simple Workflow with Pydantic

```python
class SimplePayload(BaseModel):
    name: str = "World"

class SimpleResult(BaseModel):
    message: str

@workflow
async def simple_workflow(ctx: WorkflowContext, payload: SimplePayload) -> SimpleResult:
    greeting = await ctx.step.run(
        "generate_greeting",
        lambda: f"Hello, {payload.name}!",
    )
    return SimpleResult(message=greeting)
```

### Order Processing Workflow

```python
class OrderPayload(BaseModel):
    order_id: str
    customer_email: str
    items: list[str]
    total_amount: float

class OrderResult(BaseModel):
    order_id: str
    status: str
    confirmation_number: str

@workflow(id="order_processor")
async def process_order(ctx: WorkflowContext, payload: OrderPayload) -> OrderResult:
    await ctx.step.run("validate", validate_order, payload)
    await ctx.step.run("reserve", reserve_inventory, payload.items)
    confirmation = await ctx.step.uuid("confirmation")
    return OrderResult(
        order_id=payload.order_id,
        status="completed",
        confirmation_number=confirmation,
    )
```

### Child Workflow Invocation

```python
class ParentPayload(BaseModel):
    items: list[ItemData]

class ParentResult(BaseModel):
    total_items: int
    valid_items: int
    results: list[ValidateEnrichResult]

@workflow(id="parent_workflow")
async def parent_workflow(ctx: WorkflowContext, payload: ParentPayload) -> ParentResult:
    results = []
    for i, item in enumerate(payload.items):
        # Invoke child workflow and wait for result
        child_result = await ctx.step.invoke_and_wait(
            f"validate_item_{i}",
            validate_and_enrich,
            ValidateEnrichPayload(data=item.model_dump(), validation_type="basic"),
        )
        results.append(ValidateEnrichResult(**child_result))

    return ParentResult(
        total_items=len(payload.items),
        valid_items=sum(1 for r in results if r.valid),
        results=results,
    )
```

### Step Operations

```python
# Execute a function as a durable step
result = await ctx.step.run("step_name", my_function, arg1, arg2)

# Custom retry configuration
result = await ctx.step.run(
    "unreliable_step",
    call_external_api,
    max_retries=5,
    base_delay=2.0,
    max_delay=30.0,
)

# Wait for a duration
await ctx.step.wait_for("cooldown", seconds=30)

# Deterministic random (same value on replay)
value = await ctx.step.random("random_value")

# Deterministic UUID (same value on replay)
id = await ctx.step.uuid("unique_id")

# Deterministic timestamp (same value on replay)
timestamp = await ctx.step.now("current_time")

# Invoke child workflow
result = await ctx.step.invoke_and_wait("step_key", child_workflow, payload)
```

## Running Workflows from Client

```python
from polos import PolosClient
from workflows import simple_workflow, SimplePayload

client = PolosClient(project_id="...", api_url="http://localhost:8080")

# Run workflow with Pydantic payload
result = await simple_workflow.run(client, SimplePayload(name="Alice"))
print(result.message)  # "Hello, Alice!"
```

## Workflow Context

The `WorkflowContext` provides:

- `ctx.workflow_id` - Current workflow ID
- `ctx.execution_id` - Unique execution identifier
- `ctx.session_id` - Session ID (if set)
- `ctx.user_id` - User ID (if set)
- `ctx.step` - Step helper for durable operations

## Error Handling

Steps automatically retry on failure:

```python
# Default: 2 retries with 1-10 second backoff
result = await ctx.step.run("my_step", my_function)

# Custom retry settings
result = await ctx.step.run(
    "my_step",
    my_function,
    max_retries=5,      # Retry up to 5 times
    base_delay=2.0,     # Start with 2 second delay
    max_delay=60.0,     # Cap at 60 seconds
)
```

If all retries fail, the workflow fails with `StepExecutionError`.
