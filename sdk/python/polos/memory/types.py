"""Types for the session compaction memory system.

Two-tier memory:
- Tier 1: Rolling summary of older messages (compacted via LLM)
- Tier 2: Recent raw messages kept verbatim
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SessionMemory(BaseModel):
    """Full session memory state."""

    summary: str | None = None
    messages: list[dict] = Field(default_factory=list)


class CompactionConfig(BaseModel):
    """User-facing compaction configuration."""

    max_conversation_tokens: int | None = None
    max_summary_tokens: int | None = None
    min_recent_messages: int | None = None
    enabled: bool | None = None


class NormalizedCompactionConfig(BaseModel):
    """Internal - all fields resolved to concrete values."""

    max_conversation_tokens: int
    max_summary_tokens: int
    min_recent_messages: int
    enabled: bool


class CompactionResult(BaseModel):
    """Result from compact_if_needed."""

    compacted: bool
    messages: list[dict]
    summary: str | None
    summary_tokens: int
    total_turns: int
