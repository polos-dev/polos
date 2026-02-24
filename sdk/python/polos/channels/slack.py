"""Slack channel implementation — sends a Block Kit message with a "Respond"
link button when an agent suspends.

Uses ``httpx`` for HTTP requests — no slack_sdk dependency required.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx

from ..features.events import StreamEvent
from .channel import Channel, ChannelContext, ChannelOutputMode, SuspendNotification

logger = logging.getLogger(__name__)


@dataclass
class SlackChannelConfig:
    """Configuration for the Slack notification channel.

    Attributes:
        bot_token: Slack bot token (xoxb-...)
        default_channel: Default Slack channel for notifications
            (e.g., "#agent-notifications")
        signing_secret: Optional Slack signing secret for verifying inbound webhooks
    """

    bot_token: str
    default_channel: str
    signing_secret: str | None = None


# Minimal Slack Block Kit block type
SlackBlock = dict[str, Any]

SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage"


class SlackChannel(Channel):
    """Slack notification channel that posts Block Kit messages with a "Respond"
    link button pointing to the approval page.
    """

    def __init__(self, config: SlackChannelConfig) -> None:
        if not config.bot_token.startswith("xoxb-"):
            raise ValueError(
                'Invalid Slack bot token: must start with "xoxb-". '
                "Use the Bot User OAuth Token from your Slack app's "
                "OAuth & Permissions page."
            )
        self._config = config

    @property
    def id(self) -> str:
        return "slack"

    @property
    def output_mode(self) -> ChannelOutputMode:
        return "per_step"

    async def notify(self, notification: SuspendNotification) -> dict[str, Any] | None:
        overrides = notification.channel_overrides
        channel = (overrides.get("channel") if overrides else None) or self._config.default_channel
        thread_ts = (overrides.get("thread_ts") or overrides.get("threadTs")) if overrides else None
        blocks = self._build_blocks(notification)
        text = notification.title or "Agent needs your input"

        message_ts = await self._post_message(channel, thread_ts, text, blocks)
        return {
            "slack_channel": channel,
            "slack_message_ts": message_ts,
            "slack_blocks": blocks,
        }

    async def send_output(self, context: ChannelContext, event: StreamEvent) -> None:
        channel = context.source.get("channel")
        thread_ts = context.source.get("threadTs")
        if not channel:
            return

        text = self._format_output_event(event)
        if not text:
            return

        await self._post_message(channel, thread_ts, text)

    # ── Private helpers ──

    async def _post_message(
        self,
        channel: str,
        thread_ts: str | None,
        text: str,
        blocks: list[SlackBlock] | None = None,
    ) -> str:
        body: dict[str, Any] = {"channel": channel, "text": text}
        if thread_ts:
            body["thread_ts"] = thread_ts
        if blocks:
            body["blocks"] = blocks

        async with httpx.AsyncClient() as client:
            response = await client.post(
                SLACK_POST_MESSAGE_URL,
                json=body,
                headers={
                    "Authorization": f"Bearer {self._config.bot_token}",
                    "Content-Type": "application/json",
                },
            )

        data = response.json()
        if not data.get("ok"):
            raise RuntimeError(f"Slack API error: {data.get('error', 'unknown')}")
        return data.get("ts", "")

    def _format_output_event(self, event: StreamEvent) -> str | None:
        event_type = event.event_type

        if event_type in ("workflow_finish", "agent_finish"):
            metadata = event.data.get("_metadata") or {}
            raw_result = event.data.get("result")
            error = event.data.get("error")
            workflow_id = metadata.get("workflow_id")
            label = workflow_id or "Workflow"

            if error:
                return f"\u274c *{label} failed:* {error}"

            # Extract the text result — the event data may wrap it in
            # { result, agent_run_id, usage, ... }
            result = raw_result
            if isinstance(raw_result, dict) and "result" in raw_result:
                result = raw_result["result"]

            if result is not None:
                result_str = result if isinstance(result, str) else json.dumps(result, indent=2)
                return result_str

            return f"\u2705 *{label} finished*"

        if event_type == "tool_call":
            tool_call = event.data.get("tool_call")
            if isinstance(tool_call, dict):
                fn = tool_call.get("function")
                if isinstance(fn, dict):
                    name = fn.get("name")
                    if name:
                        return f"\U0001f527 Calling tool: `{name}`"
            return None

        if event_type == "step_finish":
            step_key = event.data.get("step_key")
            error = event.data.get("error")
            if error:
                return f"\u26a0\ufe0f Step `{step_key or 'unknown'}` failed: {error}"
            return None

        # text_delta: skip individual deltas to avoid noise
        return None

    def _build_blocks(self, n: SuspendNotification) -> list[SlackBlock]:
        blocks: list[SlackBlock] = []

        # Header
        blocks.append(
            {
                "type": "header",
                "text": {"type": "plain_text", "text": n.title or "Agent needs your input"},
            }
        )

        # Description
        if n.description:
            blocks.append(
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": n.description},
                }
            )

        # Source/tool metadata
        if n.source or n.tool:
            parts: list[str] = []
            if n.source:
                parts.append(f"*Source:* {n.source}")
            if n.tool:
                parts.append(f"*Tool:* `{n.tool}`")
            blocks.append(
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": "  |  ".join(parts)}],
                }
            )

        # Context data (tool arguments, etc.)
        if n.context and len(n.context) > 0:
            context_text = json.dumps(n.context, indent=2)
            blocks.append(
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f"```{context_text}```"},
                }
            )

        # Expiry warning
        if n.expires_at:
            blocks.append(
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": f"Expires: {n.expires_at}"}],
                }
            )

        # Action buttons — inline Approve/Reject for simple approvals, link button otherwise
        if self._is_simple_approval(n):
            approve_value = json.dumps(
                {
                    "executionId": n.execution_id,
                    "stepKey": n.step_key,
                    "approved": True,
                }
            )
            reject_value = json.dumps(
                {
                    "executionId": n.execution_id,
                    "stepKey": n.step_key,
                    "approved": False,
                }
            )
            blocks.append(
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "action_id": "polos_approve",
                            "text": {"type": "plain_text", "text": "Approve"},
                            "style": "primary",
                            "value": approve_value,
                        },
                        {
                            "type": "button",
                            "action_id": "polos_reject",
                            "text": {"type": "plain_text", "text": "Reject"},
                            "style": "danger",
                            "value": reject_value,
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "View Details"},
                            "url": n.approval_url,
                        },
                    ],
                }
            )
        else:
            blocks.append(
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "Respond"},
                            "url": n.approval_url,
                            "style": "primary",
                        },
                    ],
                }
            )

        return blocks

    def _is_simple_approval(self, n: SuspendNotification) -> bool:
        fields = n.form_fields
        if not fields or len(fields) == 0:
            return False
        return any(f.get("key") == "approved" and f.get("type") == "boolean" for f in fields)
