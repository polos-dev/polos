"""Tests for SlackChannel — mirrors TypeScript sdk/typescript/src/channels/slack.test.ts."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from polos.channels.channel import ChannelContext, SuspendNotification
from polos.channels.slack import SlackChannel, SlackChannelConfig
from polos.features.events import StreamEvent

# ── Helpers ──


def make_notification(**overrides: Any) -> SuspendNotification:
    """Build a minimal SuspendNotification with optional overrides."""
    defaults = {
        "workflow_id": "wf-1",
        "execution_id": "exec-1",
        "step_key": "step-1",
        "approval_url": "https://example.com/approve/exec-1/step-1",
    }
    defaults.update(overrides)
    return SuspendNotification(**defaults)


def _mock_httpx_response(ok: bool = True, error: str | None = None):
    """Return a mock for httpx.AsyncClient.post that captures the request body."""
    captured: dict[str, Any] = {}

    async def _post(url: str, *, json: Any = None, headers: Any = None) -> Any:
        captured["body"] = json
        # Use MagicMock (not AsyncMock) since httpx Response.json() is synchronous
        mock_resp = MagicMock()
        resp_data: dict[str, Any] = {"ok": ok, "ts": "1234567890.123456"}
        if error:
            resp_data["error"] = error
        mock_resp.json.return_value = resp_data
        return mock_resp

    return captured, _post


VALID_CONFIG = SlackChannelConfig(bot_token="xoxb-test-token", default_channel="#test")


# ── Constructor ──


class TestConstructor:
    def test_throws_on_invalid_bot_token(self):
        with pytest.raises(ValueError, match="xoxb-"):
            SlackChannel(SlackChannelConfig(bot_token="bad-token", default_channel="#test"))

    def test_accepts_valid_xoxb_token(self):
        ch = SlackChannel(VALID_CONFIG)
        assert ch.id == "slack"


# ── notify — simple approval (Approve/Reject buttons) ──


class TestNotifySimpleApproval:
    @pytest.mark.asyncio
    async def test_renders_approve_reject_and_view_details_buttons(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            await channel.notify(
                make_notification(
                    title="Tool approval",
                    form_fields=[
                        {"key": "approved", "type": "boolean", "label": "Approved"},
                        {"key": "feedback", "type": "string", "label": "Feedback"},
                    ],
                )
            )

        blocks = captured["body"]["blocks"]
        actions_block = next(b for b in blocks if b["type"] == "actions")
        elements = actions_block["elements"]
        assert len(elements) == 3

        # Approve button
        assert elements[0]["action_id"] == "polos_approve"
        assert elements[0]["style"] == "primary"
        approve_value = json.loads(elements[0]["value"])
        assert approve_value["executionId"] == "exec-1"
        assert approve_value["stepKey"] == "step-1"
        assert approve_value["approved"] is True

        # Reject button
        assert elements[1]["action_id"] == "polos_reject"
        assert elements[1]["style"] == "danger"
        reject_value = json.loads(elements[1]["value"])
        assert reject_value["approved"] is False

        # View Details link button
        assert elements[2]["url"] == "https://example.com/approve/exec-1/step-1"
        assert elements[2]["text"]["text"] == "View Details"

    @pytest.mark.asyncio
    async def test_encodes_correct_execution_id_and_step_key(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            await channel.notify(
                make_notification(
                    execution_id="abc-123",
                    step_key="approval_step",
                    form_fields=[{"key": "approved", "type": "boolean"}],
                )
            )

        blocks = captured["body"]["blocks"]
        actions_block = next(b for b in blocks if b["type"] == "actions")
        elements = actions_block["elements"]
        approve_value = json.loads(elements[0]["value"])
        assert approve_value["executionId"] == "abc-123"
        assert approve_value["stepKey"] == "approval_step"


# ── notify — complex form (Respond link button) ──


class TestNotifyComplexForm:
    @pytest.mark.asyncio
    async def test_renders_respond_link_when_no_form_fields(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            await channel.notify(make_notification())

        blocks = captured["body"]["blocks"]
        actions_block = next(b for b in blocks if b["type"] == "actions")
        elements = actions_block["elements"]
        assert len(elements) == 1
        assert elements[0]["text"]["text"] == "Respond"
        assert elements[0]["url"] == "https://example.com/approve/exec-1/step-1"
        assert elements[0]["style"] == "primary"

    @pytest.mark.asyncio
    async def test_renders_respond_link_when_form_fields_empty(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            await channel.notify(make_notification(form_fields=[]))

        blocks = captured["body"]["blocks"]
        actions_block = next(b for b in blocks if b["type"] == "actions")
        elements = actions_block["elements"]
        assert len(elements) == 1
        assert elements[0]["text"]["text"] == "Respond"

    @pytest.mark.asyncio
    async def test_renders_respond_when_fields_lack_boolean_approved(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            await channel.notify(
                make_notification(
                    form_fields=[
                        {"key": "name", "type": "string"},
                        {"key": "count", "type": "number"},
                    ]
                )
            )

        blocks = captured["body"]["blocks"]
        actions_block = next(b for b in blocks if b["type"] == "actions")
        elements = actions_block["elements"]
        assert len(elements) == 1
        assert elements[0]["text"]["text"] == "Respond"

    @pytest.mark.asyncio
    async def test_renders_respond_when_approved_field_not_boolean(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            await channel.notify(
                make_notification(form_fields=[{"key": "approved", "type": "string"}])
            )

        blocks = captured["body"]["blocks"]
        actions_block = next(b for b in blocks if b["type"] == "actions")
        elements = actions_block["elements"]
        assert len(elements) == 1
        assert elements[0]["text"]["text"] == "Respond"


# ── notify — Slack API error handling ──


class TestNotifySlackApiError:
    @pytest.mark.asyncio
    async def test_throws_when_slack_api_returns_not_ok(self):
        _, mock_post = _mock_httpx_response(ok=False, error="channel_not_found")
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            with pytest.raises(RuntimeError, match="channel_not_found"):
                await channel.notify(make_notification())


# ── notify — block structure ──


class TestNotifyBlockStructure:
    @pytest.mark.asyncio
    async def test_includes_header_description_context_source_expiry_blocks(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            await channel.notify(
                make_notification(
                    title="Approval Required",
                    description="Please approve this tool call",
                    source="ask_before_use",
                    tool="web_search",
                    context={"query": "test"},
                    expires_at="2026-01-01T00:00:00Z",
                )
            )

        blocks = captured["body"]["blocks"]
        types = [b["type"] for b in blocks]
        assert "header" in types
        assert "section" in types
        assert "context" in types
        assert "actions" in types


# ── sendOutput ──


class TestSendOutput:
    @pytest.mark.asyncio
    async def test_posts_to_correct_channel_and_thread(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            context = ChannelContext(
                channel_id="slack",
                source={"channel": "#general", "threadTs": "1234.5678"},
            )
            event = StreamEvent(
                id="evt-1",
                sequence_id=1,
                topic="workflow/test/exec-1",
                event_type="workflow_finish",
                data={
                    "_metadata": {"workflow_id": "test-wf"},
                    "result": "done",
                },
            )

            await channel.send_output(context, event)

        assert captured["body"]["channel"] == "#general"
        assert captured["body"]["thread_ts"] == "1234.5678"
        assert captured["body"]["text"] == "done"

    @pytest.mark.asyncio
    async def test_formats_workflow_finish_with_result(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            context = ChannelContext(
                channel_id="slack",
                source={"channel": "#general"},
            )
            event = StreamEvent(
                id="evt-1",
                sequence_id=1,
                topic="workflow/test/exec-1",
                event_type="workflow_finish",
                data={
                    "_metadata": {"workflow_id": "my-agent"},
                    "result": "Task completed successfully",
                },
            )

            await channel.send_output(context, event)

        text = captured["body"]["text"]
        assert text == "Task completed successfully"

    @pytest.mark.asyncio
    async def test_formats_tool_call_events(self):
        captured, mock_post = _mock_httpx_response()
        channel = SlackChannel(VALID_CONFIG)

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = mock_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            context = ChannelContext(
                channel_id="slack",
                source={"channel": "#general"},
            )
            event = StreamEvent(
                id="evt-1",
                sequence_id=1,
                topic="workflow/test/exec-1",
                event_type="tool_call",
                data={
                    "tool_call": {
                        "function": {"name": "web_search", "arguments": '{"query":"test"}'},
                    },
                },
            )

            await channel.send_output(context, event)

        text = captured["body"]["text"]
        assert "web_search" in text

    @pytest.mark.asyncio
    async def test_skips_text_delta_events(self):
        channel = SlackChannel(VALID_CONFIG)
        call_count = 0

        async def _counting_post(url: str, *, json: Any = None, headers: Any = None) -> Any:
            nonlocal call_count
            call_count += 1
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"ok": True}
            return mock_resp

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = _counting_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            context = ChannelContext(
                channel_id="slack",
                source={"channel": "#general"},
            )
            event = StreamEvent(
                id="evt-1",
                sequence_id=1,
                topic="workflow/test/exec-1",
                event_type="text_delta",
                data={"content": "hello"},
            )

            await channel.send_output(context, event)

        assert call_count == 0

    @pytest.mark.asyncio
    async def test_skips_when_channel_missing_from_context(self):
        channel = SlackChannel(VALID_CONFIG)
        call_count = 0

        async def _counting_post(url: str, *, json: Any = None, headers: Any = None) -> Any:
            nonlocal call_count
            call_count += 1
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"ok": True}
            return mock_resp

        with patch("polos.channels.slack.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.post = _counting_post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            context = ChannelContext(
                channel_id="slack",
                source={},
            )
            event = StreamEvent(
                id="evt-1",
                sequence_id=1,
                topic="workflow/test/exec-1",
                event_type="workflow_finish",
                data={"result": "done"},
            )

            await channel.send_output(context, event)

        assert call_count == 0
