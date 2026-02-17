"""Unit tests for polos.memory.tokens module."""

import json
import math

from polos.memory.tokens import (
    estimate_message_tokens,
    estimate_messages_tokens,
    estimate_tokens,
)


class TestEstimateTokens:
    """Tests for estimate_tokens function."""

    def test_empty_string(self):
        assert estimate_tokens("") == 0

    def test_single_character(self):
        assert estimate_tokens("a") == 1

    def test_ceil_division(self):
        # 'hello world' = 11 chars -> ceil(11/4) = 3
        assert estimate_tokens("hello world") == 3

    def test_exact_divisible_by_4(self):
        assert estimate_tokens("abcd") == 1
        assert estimate_tokens("abcdefgh") == 2

    def test_rounds_up(self):
        assert estimate_tokens("abc") == 1
        assert estimate_tokens("abcde") == 2


class TestEstimateMessageTokens:
    """Tests for estimate_message_tokens function."""

    def test_string_content(self):
        msg = {"role": "user", "content": "hello world"}
        assert estimate_message_tokens(msg) == 3

    def test_object_content_via_json_stringify(self):
        msg = {"role": "assistant", "content": {"key": "value"}}
        expected = math.ceil(len(json.dumps({"key": "value"})) / 4)
        assert estimate_message_tokens(msg) == expected

    def test_array_content(self):
        msg = {"role": "user", "content": [1, 2, 3]}
        expected = math.ceil(len(json.dumps([1, 2, 3])) / 4)
        assert estimate_message_tokens(msg) == expected

    def test_empty_string_content(self):
        msg = {"role": "user", "content": ""}
        assert estimate_message_tokens(msg) == 0


class TestEstimateMessagesTokens:
    """Tests for estimate_messages_tokens function."""

    def test_empty_array(self):
        assert estimate_messages_tokens([]) == 0

    def test_sums_tokens(self):
        messages = [
            {"role": "user", "content": "hello world"},  # 3 tokens
            {"role": "assistant", "content": "hi"},  # 1 token
        ]
        assert estimate_messages_tokens(messages) == 3 + 1

    def test_mixed_content_types(self):
        messages = [
            {"role": "user", "content": "test"},  # ceil(4/4) = 1
            {"role": "assistant", "content": {"answer": "yes"}},
        ]
        expected = 1 + math.ceil(len(json.dumps({"answer": "yes"})) / 4)
        assert estimate_messages_tokens(messages) == expected

    def test_single_message_array(self):
        messages = [{"role": "user", "content": "hello world"}]
        assert estimate_messages_tokens(messages) == 3
