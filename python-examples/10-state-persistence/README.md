# State Persistence Example

This example demonstrates how workflows can maintain typed state that persists across executions.

## Features

- Typed state schemas with Pydantic
- State persistence across workflow invocations
- Initial state when starting workflows
- State accessible via `ctx.state`

## What is Workflow State?

Workflow state is a Pydantic model that:
- Is automatically saved when the workflow completes or fails
- Can be initialized with custom values when starting a workflow
- Provides type safety and validation

## Files

- `workflows.py` - Workflows with state schemas
- `worker.py` - Worker that registers workflows

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

4. Run the worker:
   ```bash
   python worker.py
   ```

## Defining State Schemas

```python
from polos import WorkflowState

class CounterState(WorkflowState):
    count: int = 0
    last_updated: str | None = None

class ShoppingCartState(WorkflowState):
    items: list[dict] = []
    total: float = 0.0
    discount_code: str | None = None
```

## Using State in Workflows

```python
from polos import workflow, WorkflowContext, WorkflowState

class MyState(WorkflowState):
    counter: int = 0
    items: list[str] = []

@workflow(id="my_workflow", state_schema=MyState)
async def my_workflow(ctx: WorkflowContext, payload: dict) -> dict:
    # Read state
    current_count = ctx.state.counter

    # Modify state
    ctx.state.counter += 1
    ctx.state.items.append("new item")

    return {"count": ctx.state.counter}
```

## Initial State

When invoking a workflow, you can provide initial state:

```python
# From another workflow
handle = await ctx.step.invoke(
    "invoke_child",
    child_workflow,
    payload={"action": "start"},
    initial_state={"counter": 10, "items": ["preset"]},
)
```

## State vs Steps

| Feature | State (`ctx.state`) | Steps (`ctx.step.run`) |
|---------|---------------------|------------------------|
| **Purpose** | Persistent data across invocations | Durable step execution |
| **Saved** | On workflow completion | After each step |
| **Typed** | Yes (Pydantic models) | Yes (return values) |
| **Mutable** | Yes, modify directly | No, create new values |

## Example Use Cases

### Counter
```python
class CounterState(WorkflowState):
    count: int = 0

@workflow(state_schema=CounterState)
async def counter(ctx, payload):
    ctx.state.count += payload.get("increment", 1)
    return {"count": ctx.state.count}
```

### Shopping Cart
```python
class CartState(WorkflowState):
    items: list[dict] = []
    total: float = 0.0

@workflow(state_schema=CartState)
async def cart(ctx, payload):
    if payload["action"] == "add":
        ctx.state.items.append(payload["item"])
        ctx.state.total += payload["item"]["price"]
    return {"items": ctx.state.items, "total": ctx.state.total}
```

### Conversation History
```python
class ConversationState(WorkflowState):
    messages: list[dict] = []
    turn_count: int = 0

@workflow(state_schema=ConversationState)
async def chat(ctx, payload):
    ctx.state.messages.append({"role": "user", "content": payload["message"]})
    ctx.state.turn_count += 1
    # ... generate response
    return {"history": ctx.state.messages}
```
