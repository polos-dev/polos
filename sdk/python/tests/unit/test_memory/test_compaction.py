"""Unit tests for polos.memory.compaction module."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from polos.memory.compaction import (
    COMPACTION_PROMPT,
    SUMMARY_ASSISTANT_ACK,
    SUMMARY_USER_PREFIX,
    build_summary_messages,
    compact_if_needed,
    is_summary_pair,
)
from polos.memory.types import NormalizedCompactionConfig

# -- Helpers ----------------------------------------------------------------


def long_content(tokens: int) -> str:
    """Generate content that estimates to approximately `tokens` tokens.

    estimate_tokens uses ceil(len(text) / 4), so N*4 chars ≈ N tokens.
    """
    return "x" * (tokens * 4)


def make_config(**overrides) -> NormalizedCompactionConfig:
    """Build a NormalizedCompactionConfig with test-friendly defaults."""
    defaults = {
        "max_conversation_tokens": 100,
        "max_summary_tokens": 50,
        "min_recent_messages": 4,
        "enabled": True,
    }
    defaults.update(overrides)
    return NormalizedCompactionConfig(**defaults)


def make_mock_ctx():
    """Create a mock context for compaction tests."""
    ctx = MagicMock()
    ctx.execution_id = "test-execution"
    return ctx


def make_agent_config():
    """Create a mock agent config for compaction tests."""
    return {
        "provider": "openai",
        "model": "gpt-4",
    }


# -- Constants ----------------------------------------------------------------


class TestConstants:
    """Tests for module constants."""

    def test_compaction_prompt_contains_existing_summary_placeholder(self):
        assert "{existing_summary}" in COMPACTION_PROMPT

    def test_compaction_prompt_contains_messages_placeholder(self):
        assert "{messages_to_fold}" in COMPACTION_PROMPT

    def test_summary_user_prefix_starts_correctly(self):
        assert SUMMARY_USER_PREFIX.startswith("[Prior conversation summary]")

    def test_summary_assistant_ack_is_nonempty(self):
        assert len(SUMMARY_ASSISTANT_ACK) > 0


# -- build_summary_messages ---------------------------------------------------


class TestBuildSummaryMessages:
    """Tests for build_summary_messages function."""

    def test_returns_user_assistant_pair(self):
        result = build_summary_messages("test summary")
        assert len(result) == 2
        assert result[0]["role"] == "user"
        assert result[1]["role"] == "assistant"

    def test_user_message_starts_with_prefix(self):
        result = build_summary_messages("test summary")
        assert result[0]["content"].startswith(SUMMARY_USER_PREFIX)

    def test_user_message_contains_summary(self):
        result = build_summary_messages("my important summary")
        assert "my important summary" in result[0]["content"]

    def test_assistant_message_is_ack(self):
        result = build_summary_messages("test summary")
        assert result[1]["content"] == SUMMARY_ASSISTANT_ACK


# -- is_summary_pair ----------------------------------------------------------


class TestIsSummaryPair:
    """Tests for is_summary_pair function."""

    def test_valid_summary_pair(self):
        user, assistant = build_summary_messages("some summary")
        messages = [user, assistant]
        assert is_summary_pair(messages, 0) is True

    def test_out_of_bounds(self):
        messages = [{"role": "user", "content": "hi"}]
        assert is_summary_pair(messages, 0) is False

    def test_regular_messages(self):
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
        assert is_summary_pair(messages, 0) is False

    def test_wrong_roles(self):
        messages = [
            {"role": "assistant", "content": SUMMARY_USER_PREFIX + "summary"},
            {"role": "user", "content": SUMMARY_ASSISTANT_ACK},
        ]
        assert is_summary_pair(messages, 0) is False

    def test_user_content_not_prefix(self):
        messages = [
            {"role": "user", "content": "not a summary"},
            {"role": "assistant", "content": SUMMARY_ASSISTANT_ACK},
        ]
        assert is_summary_pair(messages, 0) is False

    def test_assistant_content_not_ack(self):
        messages = [
            {"role": "user", "content": SUMMARY_USER_PREFIX + "summary"},
            {"role": "assistant", "content": "something else"},
        ]
        assert is_summary_pair(messages, 0) is False

    def test_non_zero_index(self):
        summary_user, summary_assistant = build_summary_messages("summary")
        messages = [
            {"role": "user", "content": "earlier message"},
            summary_user,
            summary_assistant,
        ]
        assert is_summary_pair(messages, 0) is False
        assert is_summary_pair(messages, 1) is True

    def test_non_string_content(self):
        messages = [
            {"role": "user", "content": {"text": SUMMARY_USER_PREFIX + "summary"}},
            {"role": "assistant", "content": SUMMARY_ASSISTANT_ACK},
        ]
        assert is_summary_pair(messages, 0) is False


# -- compact_if_needed --------------------------------------------------------


class TestCompactIfNeeded:
    """Tests for compact_if_needed function."""

    @pytest.mark.asyncio
    async def test_no_op_when_under_budget(self):
        """Return no-op when under budget."""
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
        ]
        config = make_config(max_conversation_tokens=1000)
        ctx = make_mock_ctx()

        result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.compacted is False
        assert result.messages == messages
        assert result.summary is None

    @pytest.mark.asyncio
    async def test_no_op_single_message_over_budget(self):
        """Single message can't be folded (minRecentMessages=4 > 1 message)."""
        messages = [{"role": "user", "content": long_content(200)}]
        config = make_config(max_conversation_tokens=10)
        ctx = make_mock_ctx()

        result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.compacted is False
        assert result.messages == messages

    @pytest.mark.asyncio
    async def test_no_op_all_within_min_recent(self):
        """4 messages with minRecentMessages=4 -> nothing to fold."""
        messages = [
            {"role": "user", "content": long_content(30)},
            {"role": "assistant", "content": long_content(30)},
            {"role": "user", "content": long_content(30)},
            {"role": "assistant", "content": long_content(30)},
        ]
        config = make_config(max_conversation_tokens=10, min_recent_messages=4)
        ctx = make_mock_ctx()

        result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.compacted is False

    @pytest.mark.asyncio
    async def test_compacts_when_over_budget(self):
        """8 messages, minRecentMessages=2 -> messages 0-5 folded, 6-7 kept."""
        messages = [
            {"role": "user", "content": long_content(20)},
            {"role": "assistant", "content": long_content(20)},
            {"role": "user", "content": long_content(20)},
            {"role": "assistant", "content": long_content(20)},
            {"role": "user", "content": long_content(20)},
            {"role": "assistant", "content": long_content(20)},
            {"role": "user", "content": "recent question"},
            {"role": "assistant", "content": "recent answer"},
        ]
        config = make_config(max_conversation_tokens=10, min_recent_messages=2)
        ctx = make_mock_ctx()

        with patch(
            "polos.memory.compaction._call_compaction_llm",
            new_callable=AsyncMock,
            return_value="This is a compacted summary.",
        ):
            result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.compacted is True
        assert result.summary is not None
        # summary pair (2) + recent (2) = 4
        assert len(result.messages) == 4
        assert is_summary_pair(result.messages, 0) is True
        assert result.messages[2]["content"] == "recent question"
        assert result.messages[3]["content"] == "recent answer"

    @pytest.mark.asyncio
    async def test_preserves_min_recent_messages(self):
        """10 messages with minRecentMessages=4 -> last 4 kept."""
        messages = []
        for i in range(10):
            messages.append(
                {
                    "role": "user" if i % 2 == 0 else "assistant",
                    "content": long_content(20),
                }
            )
        config = make_config(max_conversation_tokens=10, min_recent_messages=4)
        ctx = make_mock_ctx()

        with patch(
            "polos.memory.compaction._call_compaction_llm",
            new_callable=AsyncMock,
            return_value="This is a compacted summary.",
        ):
            result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.compacted is True
        # summary pair (2) + minRecentMessages (4) = 6
        assert len(result.messages) == 6
        # Last 4 should be the original last 4 messages
        for i in range(4):
            assert result.messages[i + 2] == messages[len(messages) - 4 + i]

    @pytest.mark.asyncio
    async def test_detects_and_replaces_existing_summary(self):
        """Existing summary pair is detected and replaced."""
        existing_user, existing_assistant = build_summary_messages("old summary")
        messages = [
            existing_user,
            existing_assistant,
            {"role": "user", "content": long_content(30)},
            {"role": "assistant", "content": long_content(30)},
            {"role": "user", "content": long_content(30)},
            {"role": "assistant", "content": long_content(30)},
            {"role": "user", "content": "latest question"},
            {"role": "assistant", "content": "latest answer"},
        ]
        config = make_config(max_conversation_tokens=10, min_recent_messages=2)
        ctx = make_mock_ctx()

        with patch(
            "polos.memory.compaction._call_compaction_llm",
            new_callable=AsyncMock,
            return_value="new compacted summary",
        ):
            result = await compact_if_needed(
                messages, "old summary", config, ctx, make_agent_config()
            )

        assert result.compacted is True
        assert len(result.messages) == 4
        assert is_summary_pair(result.messages, 0) is True
        assert result.summary != "old summary"
        assert result.messages[2]["content"] == "latest question"
        assert result.messages[3]["content"] == "latest answer"

    @pytest.mark.asyncio
    async def test_re_summarizes_when_summary_too_long(self):
        """When summary exceeds maxSummaryTokens, it gets re-summarized."""
        call_count = 0

        async def mock_llm(ctx, agent_config, prompt, step_key_prefix):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return long_content(200)  # Too long
            return "short re-summarized"

        messages = []
        for i in range(10):
            messages.append(
                {
                    "role": "user" if i % 2 == 0 else "assistant",
                    "content": long_content(20),
                }
            )
        config = make_config(
            max_conversation_tokens=10, max_summary_tokens=50, min_recent_messages=2
        )
        ctx = make_mock_ctx()

        with patch("polos.memory.compaction._call_compaction_llm", side_effect=mock_llm):
            result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.compacted is True
        assert call_count == 2
        assert result.summary == "short re-summarized"

    @pytest.mark.asyncio
    async def test_falls_back_on_model_failure(self):
        """On LLM failure, falls back to naive truncation."""
        messages = []
        for i in range(10):
            messages.append(
                {
                    "role": "user" if i % 2 == 0 else "assistant",
                    "content": long_content(20),
                }
            )
        config = make_config(max_conversation_tokens=10, min_recent_messages=4)
        ctx = make_mock_ctx()

        with patch(
            "polos.memory.compaction._call_compaction_llm",
            new_callable=AsyncMock,
            side_effect=Exception("LLM call failed"),
        ):
            result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.compacted is True
        assert len(result.messages) == 4
        # Messages should be the last 4 from original
        for i in range(4):
            assert result.messages[i] == messages[len(messages) - 4 + i]
        assert result.summary is None

    @pytest.mark.asyncio
    async def test_preserves_existing_summary_on_fallback(self):
        """On fallback, existing summary is preserved."""
        summary_user, summary_assistant = build_summary_messages("existing summary")
        messages = [summary_user, summary_assistant] + [
            {
                "role": "user" if i % 2 == 0 else "assistant",
                "content": long_content(20),
            }
            for i in range(8)
        ]
        config = make_config(max_conversation_tokens=10, min_recent_messages=2)
        ctx = make_mock_ctx()

        with patch(
            "polos.memory.compaction._call_compaction_llm",
            new_callable=AsyncMock,
            side_effect=Exception("LLM call failed"),
        ):
            result = await compact_if_needed(
                messages, "existing summary", config, ctx, make_agent_config()
            )

        assert result.compacted is True
        assert len(result.messages) == 2
        assert result.summary == "existing summary"

    @pytest.mark.asyncio
    async def test_correct_summary_tokens(self):
        """summary_tokens in result matches estimate of the summary."""
        import math

        summary_text = "This is a compacted summary."
        messages = []
        for i in range(8):
            messages.append(
                {
                    "role": "user" if i % 2 == 0 else "assistant",
                    "content": long_content(20),
                }
            )
        config = make_config(max_conversation_tokens=10, min_recent_messages=2)
        ctx = make_mock_ctx()

        with patch(
            "polos.memory.compaction._call_compaction_llm",
            new_callable=AsyncMock,
            return_value=summary_text,
        ):
            result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.compacted is True
        assert result.summary_tokens == math.ceil(len(summary_text) / 4)

    @pytest.mark.asyncio
    async def test_total_turns_equals_original_count(self):
        """total_turns in result equals original message count."""
        messages = []
        for i in range(8):
            messages.append(
                {
                    "role": "user" if i % 2 == 0 else "assistant",
                    "content": long_content(20),
                }
            )
        config = make_config(max_conversation_tokens=10, min_recent_messages=2)
        ctx = make_mock_ctx()

        with patch(
            "polos.memory.compaction._call_compaction_llm",
            new_callable=AsyncMock,
            return_value="compacted",
        ):
            result = await compact_if_needed(messages, None, config, ctx, make_agent_config())

        assert result.total_turns == 8
