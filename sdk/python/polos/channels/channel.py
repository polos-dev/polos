"""Channel abstraction for delivering notifications when agents suspend.

Channels are registered on the Worker and called automatically when any
workflow suspends (e.g., via ask_user or tool approval). Implementations
should be stateless and safe to call concurrently.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Literal

from pydantic import BaseModel, Field


class ChannelContext(BaseModel):
    """Originating channel context — identifies where a trigger came from
    so that output and notifications can be routed back.

    Attributes:
        channel_id: Channel type: "slack", "discord", etc.
        source: Channel-specific source metadata
            (e.g., {"channel": "#general", "thread_ts": "..."})
    """

    channel_id: str
    source: dict[str, Any] = Field(default_factory=dict)


ChannelOutputMode = Literal["per_step", "final", "none"]
"""Controls how output events are streamed back to the originating channel.

- ``per_step``: Stream text_delta, tool_call, step_finish, and finish events
- ``final``: Only stream workflow_finish / agent_finish events
- ``none``: Do not stream output
"""


class SuspendNotification(BaseModel):
    """Data passed to channels when an agent suspends for user input.

    Attributes:
        workflow_id: Root workflow ID
        execution_id: Root execution ID
        step_key: Step key used in suspend()
        approval_url: URL to the approval page
        title: Title from _form schema
        description: Description from _form schema
        source: "ask_user", "ask_before_use", or custom
        tool: Tool name if triggered by ask_before_use
        context: Read-only context data from _form
        form_fields: Form field definitions from _form.fields
        expires_at: ISO timestamp when the approval expires
        channel_overrides: Channel-specific overrides from _notify
        channel_context: Originating channel context — used for thread routing
    """

    workflow_id: str
    execution_id: str
    step_key: str
    approval_url: str
    title: str | None = None
    description: str | None = None
    source: str | None = None
    tool: str | None = None
    context: dict[str, Any] | None = None
    form_fields: list[dict[str, Any]] | None = None
    expires_at: str | None = None
    channel_overrides: dict[str, Any] | None = None
    channel_context: ChannelContext | None = None


class Channel(ABC):
    """A notification channel for delivering suspend notifications to users.

    Channels are registered on the Worker and called automatically when any
    workflow suspends. Implementations should be stateless and safe to call
    concurrently.
    """

    @property
    @abstractmethod
    def id(self) -> str:
        """Unique channel identifier (e.g., "slack", "discord", "email")."""
        ...

    @abstractmethod
    async def notify(self, notification: SuspendNotification) -> dict[str, Any] | None:
        """Send a notification when an agent suspends for user input.

        Implementations should throw on failure — the SDK catches and logs errors.

        May return channel-specific metadata (e.g., Slack message_ts) so the
        orchestrator can update the notification later (e.g., after approval via UI).
        """
        ...

    @property
    def output_mode(self) -> ChannelOutputMode | None:
        """Default output mode for this channel."""
        return None

    async def send_output(self, context: ChannelContext, event: Any) -> None:  # noqa: B027
        """Send output events back to the originating channel."""
