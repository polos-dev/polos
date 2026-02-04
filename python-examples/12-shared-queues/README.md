# Shared Queues Example

This example demonstrates how to use queues to control concurrency across workflows.

## Features

- Define shared queues with concurrency limits
- Multiple workflows sharing the same queue
- Different queue configurations
- Resource isolation by queue

## What are Queues?

Queues control how many workflows can run concurrently:

| Queue | Concurrency | Use Case |
|-------|-------------|----------|
| `api-calls` | 5 | Rate-limit external API requests |
| `database-ops` | 10 | Limit database connections |
| `heavy-processing` | 2 | Prevent CPU exhaustion |

## Files

- `workflows.py` - Workflows with queue configurations
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

## Defining Queues

```python
from polos import queue

# Queue with concurrency limit
api_queue = queue("api-calls", concurrency_limit=5)

# Unlimited queue
unlimited_queue = queue("unlimited")
```

## Using Queues

### With Queue Object
```python
api_queue = queue("api-calls", concurrency_limit=5)

@workflow(id="my_workflow", queue=api_queue)
async def my_workflow(ctx, payload):
    # This workflow uses the api-calls queue
    pass
```

### With Inline Configuration
```python
@workflow(id="my_workflow", queue={"concurrency_limit": 3})
async def my_workflow(ctx, payload):
    # Uses workflow ID as queue name with limit of 3
    pass
```

### With Queue Name Only
```python
@workflow(id="my_workflow", queue="my-queue-name")
async def my_workflow(ctx, payload):
    # Uses named queue with default concurrency
    pass
```

## Sharing Queues

Multiple workflows can share the same queue:

```python
db_queue = queue("database-ops", concurrency_limit=10)

@workflow(id="db_read", queue=db_queue)
async def db_read(ctx, payload):
    pass

@workflow(id="db_write", queue=db_queue)
async def db_write(ctx, payload):
    pass
```

Total concurrent executions of `db_read` and `db_write` combined will not exceed 10.

## Queue Behavior

1. **Queueing**: When the limit is reached, new executions wait in the queue
2. **Fair scheduling**: Executions are processed in order
3. **Isolation**: Different queues are independent

## Use Cases

### Rate Limiting External APIs
```python
api_queue = queue("external-api", concurrency_limit=5)

@workflow(queue=api_queue)
async def call_api(ctx, payload):
    # Only 5 concurrent API calls
    pass
```

### Database Connection Pooling
```python
db_queue = queue("postgres", concurrency_limit=20)

@workflow(queue=db_queue)
async def db_operation(ctx, payload):
    # Respects connection pool limits
    pass
```

### Resource-Intensive Processing
```python
compute_queue = queue("gpu", concurrency_limit=1)

@workflow(queue=compute_queue)
async def ml_inference(ctx, payload):
    # Only one GPU job at a time
    pass
```
