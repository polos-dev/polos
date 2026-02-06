"""Event publish/subscribe system for Polos."""

import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import httpx
from pydantic import BaseModel, Field

from ..runtime.client import PolosClient
from ..utils.worker_singleton import get_worker_client

logger = logging.getLogger(__name__)


class EventData(BaseModel):
    """Event data structure for publishing events.

    Users can define TypedDict for type hints:
        from typing import TypedDict

        class ApprovalData(TypedDict):
            approved: bool
            reason: str | None

        event = EventData(
            event_type="email.approval_received",
            data={"approved": True, "reason": "Looks good"}  # TypedDict provides type hints
        )

    Attributes:
        event_type: Type of event
        data: Event payload (dict)
    """

    event_type: str | None = None
    data: dict[str, Any]


class EventPayload(BaseModel):
    """Event payload received when waiting for events in workflows.

    This is returned by ctx.step.wait_for_event() when an event is received
    and by event-triggered workflows.

    Attributes:
        id: Event ID (UUID string)
        sequence_id: Global sequence ID for ordering
        topic: Event topic
        event_type: Type of event
        data: Event payload (dict)
        created_at: Optional timestamp when event was created
    """

    id: str
    sequence_id: int
    topic: str
    event_type: str | None = None
    data: dict[str, Any]
    created_at: datetime


class EventItem(BaseModel):
    """Single event item in a batch of events.

    Used in BatchEventPayload for event-triggered workflows with batching.

    Attributes:
        id: Event ID (UUID string)
        sequence_id: Global sequence ID for ordering
        topic: Event topic
        event_type: Type of event
        data: Event payload (dict)
        created_at: Timestamp when event was created
    """

    id: str
    sequence_id: int
    topic: str
    event_type: str | None = None
    data: dict[str, Any]
    created_at: datetime


class BatchEventPayload(BaseModel):
    """Batch event payload for event-triggered workflows with batching.

    This is the payload structure when a workflow is triggered by events
    with batch_size > 1 or batch_timeout_seconds set.

    Attributes:
        events: List of events in the batch
    """

    events: list[EventItem] = Field(default_factory=list)


class StreamEvent(BaseModel):
    """Event received from the event stream.

    Attributes:
        id: Event ID (UUID string)
        sequence_id: Global sequence ID for ordering
        topic: Event topic
        event_type: Optional type of event
        data: Event payload (dict)
        created_at: Optional RFC3339 timestamp string
    """

    id: str
    sequence_id: int
    topic: str
    event_type: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None


class Event:
    """Represents an event in the event system."""

    def __init__(
        self,
        id: str,
        sequence_id: int,
        topic: str,
        event_type: str | None = None,
        data: dict[str, Any] | None = None,
        status: str = "valid",
        execution_id: str | None = None,
        attempt_number: int = 0,
        created_at: datetime | None = None,
    ):
        self.id = id
        self.sequence_id = sequence_id
        self.topic = topic
        self.event_type = event_type
        self.data = data
        self.status = status
        self.execution_id = execution_id
        self.attempt_number = attempt_number
        self.created_at = created_at

    def __repr__(self) -> str:
        return (
            f"Event(id={self.id}, sequence_id={self.sequence_id}, "
            f"topic={self.topic}, event_type={self.event_type}, "
            f"status={self.status})"
        )


async def batch_publish(
    client: PolosClient,
    topic: str,
    events: list[EventData],
    execution_id: str | None = None,
    root_execution_id: str | None = None,
) -> list[int]:
    """Publish a batch of events for a single topic. Returns list of sequence_ids.

    Args:
        client: PolosClient instance
        topic: Event topic (all events in the batch share this topic)
        events: List of EventData instances, each with:
            - event_type: str - Type of event
            - data: dict[str, Any] - Event payload (can use TypedDict for type hints)
        execution_id: Optional execution ID
        root_execution_id: Optional root execution ID

    Returns:
        List of sequence IDs

    Example:
        from typing import TypedDict

        class ApprovalData(TypedDict):
            approved: bool
            reason: str | None

        events = [
            EventData(
                event_type="email.approval_received",
                data={"approved": True, "reason": "Looks good"}
            )
        ]
        sequence_ids = await batch_publish("approvals", events)
    """
    if not events:
        return []

    # Publish events to orchestrator
    api_url = client.api_url
    headers = client._get_headers()

    # Add execution_id and attempt_number internally
    events_with_internal = []
    for e in events:
        events_with_internal.append(e.model_dump(exclude_none=True, mode="json"))

    payload = {
        "topic": topic,
        "events": events_with_internal,
    }

    # Include execution context if provided
    if execution_id:
        payload["execution_id"] = execution_id
    if root_execution_id:
        payload["root_execution_id"] = root_execution_id

    # Try to reuse worker's HTTP client if available
    worker_client = get_worker_client()
    if worker_client is not None:
        response = await worker_client.post(
            f"{api_url}/api/v1/events/publish",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        result = response.json()
        return result["sequence_ids"]
    else:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{api_url}/api/v1/events/publish",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            result = response.json()
            return result["sequence_ids"]


async def publish(
    client: PolosClient,
    topic: str,
    event_data: EventData,
    execution_id: str | None = None,
    root_execution_id: str | None = None,
) -> int:
    """Publish a single event to topic. Returns sequence_id.

    This calls batch_publish() internally with a single event.

    Args:
        client: PolosClient instance
        topic: Event topic
        event_data: EventData
        execution_id: Optional execution ID
        root_execution_id: Optional root execution ID

    Returns:
        sequence_id: Global sequence ID for the event
    """
    sequence_ids = await batch_publish(
        topic=topic,
        events=[event_data],
        execution_id=execution_id,
        root_execution_id=root_execution_id,
        client=client,
    )
    return sequence_ids[0] if sequence_ids else None


async def _stream(
    client: PolosClient,
    topic: str | None = None,
    workflow_id: str | None = None,
    workflow_run_id: str | None = None,
    last_sequence_id: int | None = None,
    last_timestamp: datetime | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream events from a topic or workflow using Server-Sent Events (SSE).

    Returns an async iterator that yields StreamEvent Pydantic instances.
    Each event contains: id, sequence_id, topic, event_type, data, created_at.
    """
    from datetime import timezone
    from urllib.parse import urlencode

    api_url = client.api_url

    # Build query parameters
    params = {
        "project_id": client.project_id,
    }

    # If workflow_run_id is provided, use it (API will construct topic from it)
    if workflow_run_id:
        if not workflow_id:
            raise ValueError("workflow_id must be provided when workflow_run_id is provided")
        params["workflow_id"] = workflow_id
        params["workflow_run_id"] = workflow_run_id
    elif topic:
        params["topic"] = topic
    else:
        raise ValueError("Either topic or workflow_run_id must be provided")

    # Priority: last_sequence_id takes precedence over last_timestamp
    if last_sequence_id is not None:
        params["last_sequence_id"] = str(last_sequence_id)
    elif last_timestamp is not None:
        # Format timestamp as RFC3339 for the server
        if last_timestamp.tzinfo is None:
            # Assume UTC if no timezone info
            last_timestamp = last_timestamp.replace(tzinfo=timezone.utc)
        params["last_timestamp"] = last_timestamp.isoformat()
    else:
        # Default to current time if neither is provided
        params["last_timestamp"] = datetime.now(timezone.utc).isoformat()

    # Build URL with query parameters
    url = f"{api_url}/api/v1/events/stream?{urlencode(params)}"

    headers = client._get_headers()

    async with (
        httpx.AsyncClient(timeout=httpx.Timeout(None), headers=headers) as http_client,
        http_client.stream("GET", url) as response,
    ):
        response.raise_for_status()

        current_event_data = None

        async for line in response.aiter_lines():
            line = line.rstrip("\r\n")

            # Empty line indicates end of event
            if not line:
                if current_event_data:
                    try:
                        event_dict = json.loads(current_event_data)
                        # Convert dict to StreamEvent Pydantic model
                        event = StreamEvent.model_validate(event_dict)
                        yield event
                    except (json.JSONDecodeError, Exception):
                        # Skip invalid events
                        pass
                    current_event_data = None
                continue

            # SSE format: data: {...}
            if line.startswith("data: "):
                data_str = line[6:]  # Remove "data: " prefix
                current_event_data = data_str
            elif line == "keepalive" or line.startswith(":"):
                # Skip keepalive messages and comments
                continue


def stream_topic(
    client: PolosClient,
    topic: str = None,
    last_sequence_id: int | None = None,
    last_timestamp: datetime | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream events from a topic using Server-Sent Events (SSE).

    Returns an async iterator that yields StreamEvent Pydantic instances.
    Each event contains: id, sequence_id, topic, event_type, data, created_at.

    Args:
        client: PolosClient instance
        topic: Event topic to stream.
        last_sequence_id: Optional sequence ID to start streaming after. If provided,
            streaming begins after this sequence ID.
        last_timestamp: Optional timestamp to start streaming after. If provided
            and last_sequence_id is None, streaming begins after this timestamp.

    Yields:
        StreamEvent: Pydantic model with fields: id, topic, event_type, data,
            sequence_id, created_at

    Example:
        async for event in events.stream_topic("review/123"):
            if event.event_type == "message":
                print(event.data.get("message"))
            elif event.event_type == "result":
                print(event.data.get("result"))
    """
    return _stream(
        client=client, topic=topic, last_sequence_id=last_sequence_id, last_timestamp=last_timestamp
    )


def stream_workflow(
    client: PolosClient,
    workflow_id: str,
    workflow_run_id: str,
    last_sequence_id: int | None = None,
    last_timestamp: datetime | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream events from a workflow using Server-Sent Events (SSE).

    Returns an async iterator that yields StreamEvent Pydantic instances.
    Each event contains: id, sequence_id, topic, event_type, data, created_at.

    The iterator automatically stops when it receives a "finish" event with
    matching execution_id, indicating the workflow has completed.

    Args:
        client: PolosClient instance
        workflow_id: Workflow ID (name) of the workflow run.
        workflow_run_id: Workflow run ID to stream events for.
        last_sequence_id: Optional sequence ID to start streaming after. If provided,
            streaming begins after this sequence ID.
        last_timestamp: Optional timestamp to start streaming after. If provided
            and last_sequence_id is None, streaming begins after this timestamp.

    Yields:
        StreamEvent: Pydantic model with fields: id, topic, event_type, data,
            sequence_id, created_at

    Example:
        async for event in events.stream_workflow("review", "123"):
            if event.event_type == "message":
                print(event.data.get("message"))
            elif event.event_type == "result":
                print(event.data.get("result"))
    """

    async def _stream_with_finish_check():
        async for event in _stream(
            client=client,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            last_sequence_id=last_sequence_id,
            last_timestamp=last_timestamp,
        ):
            yield event

            # Check for finish event with matching execution_id
            if event.event_type in ["workflow_finish", "agent_finish", "tool_finish"]:
                event_data = event.data
                if isinstance(event_data, dict):
                    metadata = event_data.get("_metadata", {})
                    if isinstance(metadata, dict):
                        execution_id = metadata.get("execution_id")
                        if execution_id == workflow_run_id:
                            # Workflow streaming is complete, stop iterating
                            break

    return _stream_with_finish_check()


# Module-level instance for convenience
events = type(
    "Events",
    (),
    {
        "publish": publish,
        "batch_publish": batch_publish,
        "stream_topic": stream_topic,
        "stream_workflow": stream_workflow,
    },
)()
