# Event-Triggered Workflows Example

This example demonstrates workflows that are automatically triggered by events.

## Features

- Event-triggered workflows with `trigger_on_event`
- Event batching for high-throughput scenarios
- Publishing events with `ctx.step.publish_event`
- Waiting for events with `ctx.step.wait_for_event`

## Use Cases

- Order processing pipelines
- User onboarding flows
- Real-time notifications
- Event-driven architectures

## Files

- `workflows.py` - Event-triggered workflow definitions
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

## Event-Triggered Workflows

### Basic Trigger

```python
@workflow(id="on_order_created", trigger_on_event="orders/created")
async def on_order_created(ctx, payload):
    events = payload.get("events", [])
    event = events[0]  # Get the first event

    order_data = event.get("data", {})
    # Process the order...
```

### Batch Processing

```python
@workflow(
    id="batch_processor",
    trigger_on_event="data/updates",
    batch_size=10,                 # Up to 10 events per batch
    batch_timeout_seconds=30,      # Or trigger after 30 seconds
)
async def batch_processor(ctx, payload):
    events = payload.get("events", [])
    for event in events:
        # Process each event in the batch
        pass
```

## Publishing Events

From within a workflow:

```python
await ctx.step.publish_event(
    "step_key",
    topic="orders/created",
    data={"order_id": "123", "total": 99.99},
    event_type="created",
)
```

## Waiting for Events

Pause workflow until an event arrives:

```python
event = await ctx.step.wait_for_event(
    "wait_for_approval",
    topic="approvals/order-123",
    timeout=3600,  # 1 hour timeout
)

# event.topic, event.event_type, event.data
```

## Event Topics

Topics are hierarchical strings:

| Topic Pattern | Description |
|---------------|-------------|
| `orders/created` | Order creation events |
| `users/signup` | User signup events |
| `approvals/{id}` | Approval for specific ID |
| `notifications` | General notifications |

## Event Payload Structure

When an event triggers a workflow, the payload contains:

```python
{
    "events": [
        {
            "sequence_id": 123,
            "topic": "orders/created",
            "event_type": "created",
            "data": {...},  # Your event data
            "created_at": "2024-01-01T12:00:00Z"
        }
    ]
}
```

For batched workflows, `events` contains multiple event objects.

## Request-Response Pattern

```python
@workflow(id="requester")
async def requester(ctx, payload):
    request_id = await ctx.step.uuid("request_id")

    # Publish request
    await ctx.step.publish_event(
        "send_request",
        topic=f"requests/{request_id}",
        data={"action": "process"},
    )

    # Wait for response
    response = await ctx.step.wait_for_event(
        "wait_response",
        topic=f"responses/{request_id}",
        timeout=300,
    )

    return response.data
```

## Best Practices

1. **Use specific topics** - Avoid overly generic topics
2. **Set appropriate timeouts** - For wait_for_event calls
3. **Handle batches** - Design for receiving multiple events
4. **Idempotency** - Events may be delivered more than once
