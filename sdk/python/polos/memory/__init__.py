"""Memory module - session compaction for long-running agent conversations."""

from .compaction import (
    COMPACTION_PROMPT,
    SUMMARY_ASSISTANT_ACK,
    SUMMARY_USER_PREFIX,
    build_summary_messages,
    compact_if_needed,
    is_summary_pair,
)
from .session_memory import get_session_memory, put_session_memory
from .tokens import estimate_message_tokens, estimate_messages_tokens, estimate_tokens
from .types import CompactionConfig, CompactionResult, NormalizedCompactionConfig, SessionMemory

__all__ = [
    "CompactionConfig",
    "CompactionResult",
    "NormalizedCompactionConfig",
    "SessionMemory",
    "COMPACTION_PROMPT",
    "SUMMARY_ASSISTANT_ACK",
    "SUMMARY_USER_PREFIX",
    "build_summary_messages",
    "compact_if_needed",
    "estimate_message_tokens",
    "estimate_messages_tokens",
    "estimate_tokens",
    "get_session_memory",
    "is_summary_pair",
    "put_session_memory",
]
