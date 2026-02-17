"""Token estimation utilities for session compaction.

Uses a simple heuristic: ~4 characters per token.
"""

from __future__ import annotations

import json
import math


def estimate_tokens(text: str) -> int:
    """Estimate token count for a string using the ~4 chars/token heuristic."""
    return math.ceil(len(text) / 4)


def estimate_message_tokens(message: dict) -> int:
    """Estimate token count for a single conversation message."""
    content = message.get("content")
    if isinstance(content, str):
        return estimate_tokens(content)
    try:
        return estimate_tokens(json.dumps(content))
    except (TypeError, ValueError):
        return 0


def estimate_messages_tokens(messages: list[dict]) -> int:
    """Estimate total token count for an array of conversation messages."""
    total = 0
    for msg in messages:
        total += estimate_message_tokens(msg)
    return total
