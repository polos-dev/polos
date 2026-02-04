"""Event-triggered workflow examples.

Demonstrates workflows that are automatically triggered by events.
Events can come from external systems, other workflows, or scheduled triggers.
"""

from pydantic import BaseModel

from polos import workflow, WorkflowContext, EventPayload, BatchEventPayload


class OrderProcessedResult(BaseModel):
    """Result from order processing workflow."""

    order_id: str
    status: str


class UserOnboardedResult(BaseModel):
    """Result from user onboarding workflow."""

    user_id: str
    onboarding: str


class BatchProcessResult(BaseModel):
    """Result from batch processing workflow."""

    batch_size: int
    processed: list[dict]


class EventPublishedResult(BaseModel):
    """Result from event publisher workflow."""

    published: bool
    topic: str
    event_type: str


class EventReceivedResult(BaseModel):
    """Result from event waiter workflow."""

    received: bool
    event_topic: str
    event_type: str | None
    event_data: dict


class ChainResult(BaseModel):
    """Result from chain with events workflow."""

    request_id: str
    response: dict


@workflow(id="on_order_created", trigger_on_event="orders/created")
async def on_order_created(
    ctx: WorkflowContext, payload: EventPayload
) -> OrderProcessedResult:
    """Triggered when an order is created.

    The trigger_on_event parameter specifies the event topic to listen for.
    When an event is published to "orders/created", this workflow runs.

    Event-triggered workflows receive an EventPayload containing the event.
    """
    order_data = payload.data
    order_id = order_data.get("order_id", "unknown")

    await ctx.step.run(
        "started_order",
        lambda: print("Order processing started"),
    )

    # Process the order
    await ctx.step.run(
        "validate_order",
        lambda: {"valid": True, "order_id": order_id},
    )

    # Reserve inventory
    await ctx.step.run(
        "reserve_inventory",
        lambda: {"reserved": True},
    )

    # Send confirmation
    await ctx.step.run(
        "send_confirmation",
        lambda: {"sent": True},
    )

    await ctx.step.run(
        "order_processed",
        lambda: print("Order processing completed"),
    )

    return OrderProcessedResult(
        order_id=order_id,
        status="processed",
    )


@workflow(id="on_user_signup", trigger_on_event="users/signup")
async def on_user_signup(
    ctx: WorkflowContext, payload: EventPayload
) -> UserOnboardedResult:
    """Triggered when a new user signs up."""
    user_data = payload.data
    user_id = user_data.get("user_id", "unknown")

    await ctx.step.run(
        "user_signed_up",
        lambda: print("User signed up"),
    )

    # Send welcome email
    await ctx.step.run(
        "send_welcome_email",
        lambda: {"sent": True, "user_id": user_id},
    )

    # Create initial setup
    await ctx.step.run(
        "create_user_settings",
        lambda: {"created": True},
    )

    # Track analytics event
    await ctx.step.run(
        "track_signup",
        lambda: {"tracked": True},
    )

    await ctx.step.run(
        "user_onboarded",
        lambda: print("User onboarded"),
    )

    return UserOnboardedResult(
        user_id=user_id,
        onboarding="complete",
    )


@workflow(
    id="batch_processor",
    trigger_on_event="data/updates",
    batch_size=10,
    batch_timeout_seconds=30,
)
async def batch_processor(
    ctx: WorkflowContext, payload: BatchEventPayload
) -> BatchProcessResult:
    """Process events in batches.

    With batch_size and batch_timeout_seconds, events are batched together.
    The workflow receives up to 10 events at once, or triggers after 30 seconds
    if fewer events are available.
    """
    await ctx.step.run(
        "batch_processor_started",
        lambda: print("Batch processor started"),
    )

    processed = []
    for event in payload.events:
        result = await ctx.step.run(
            f"process_event_{event.sequence_id}",
            process_event_data,
            event.data,
        )
        processed.append(result)

    await ctx.step.run(
        "batch_processor_completed",
        lambda: print(f"Batch processor completed. Processed {len(payload.events)} events"),
    )

    return BatchProcessResult(
        batch_size=len(payload.events),
        processed=processed,
    )


def process_event_data(data: dict) -> dict:
    """Process a single event."""
    return {"processed": True, "data": data}


# --- Non-event-triggered workflows for publishing/waiting ---


class PublishEventPayload(BaseModel):
    """Input for event publisher workflow."""

    topic: str = "orders/created"
    event_data: dict = {}
    event_type: str = "created"


@workflow(id="event_publisher")
async def event_publisher(
    ctx: WorkflowContext, payload: PublishEventPayload
) -> EventPublishedResult:
    """Workflow that publishes events to trigger other workflows.

    Use ctx.step.publish_event to publish events that can trigger
    other event-triggered workflows.
    """
    # Publish event
    await ctx.step.publish_event(
        "publish_event",
        topic=payload.topic,
        data=payload.event_data,
        event_type=payload.event_type,
    )

    return EventPublishedResult(
        published=True,
        topic=payload.topic,
        event_type=payload.event_type,
    )


class WaitForEventPayload(BaseModel):
    """Input for event waiter workflow."""

    topic: str = "notifications"
    timeout: int = 3600  # 1 hour default


@workflow(id="event_waiter")
async def event_waiter(
    ctx: WorkflowContext, payload: WaitForEventPayload
) -> EventReceivedResult:
    """Workflow that waits for a specific event.

    Uses wait_for_event to pause until an event is published
    to the specified topic.
    """
    # Wait for event
    event = await ctx.step.wait_for_event(
        "wait_for_notification",
        topic=payload.topic,
        timeout=payload.timeout,
    )

    await ctx.step.run(
        "event_received",
        lambda: print(f"Event received: {event.topic} {event.data}"),
    )

    return EventReceivedResult(
        received=True,
        event_topic=event.topic,
        event_type=event.event_type,
        event_data=event.data,
    )


class ChainPayload(BaseModel):
    """Input for chain with events workflow."""

    action: str = "process"


@workflow(id="chain_with_events")
async def chain_with_events(ctx: WorkflowContext, payload: ChainPayload) -> ChainResult:
    """Workflow that chains operations using events.

    Demonstrates publishing events and waiting for responses.
    """
    request_id = await ctx.step.uuid("request_id")

    # Publish a request event
    await ctx.step.publish_event(
        "publish_request",
        topic=f"requests/{request_id}",
        data={"request_id": request_id, "action": payload.action},
        event_type="request",
    )

    # Wait for response event
    response = await ctx.step.wait_for_event(
        "wait_for_response",
        topic=f"responses/{request_id}",
        timeout=300,  # 5 minute timeout
    )

    await ctx.step.run(
        "response_received",
        lambda: print(f"Response received: {response.topic} {response.data}"),
    )

    return ChainResult(
        request_id=request_id,
        response=response.data,
    )
