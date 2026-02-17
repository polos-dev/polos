"""Core session compaction logic.

Compacts older conversation messages into a rolling summary via an LLM call,
keeping the last N recent messages verbatim.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .tokens import estimate_messages_tokens, estimate_tokens
from .types import CompactionResult, NormalizedCompactionConfig

logger = logging.getLogger(__name__)

# -- Constants ----------------------------------------------------------------

COMPACTION_PROMPT = (
    "You are summarizing a conversation between a user and an AI assistant.\n"
    "\n"
    "Your goal: someone reading only this summary should be able to continue "
    "the conversation without the user having to repeat themselves.\n"
    "\n"
    "Capture:\n"
    "- What the user is trying to accomplish (their goal, problem, or question)\n"
    "- Key facts, context, or constraints the user shared "
    "(personal details, preferences, requirements, deadlines)\n"
    "- Decisions made or conclusions reached\n"
    "- Recommendations given and whether the user accepted, rejected, "
    "or is still considering them\n"
    "- Any specific artifacts produced (code, files, plans, drafts, lists "
    "— include names and key details)\n"
    "- Open threads — anything unresolved, in progress, or that the user "
    "said they'd come back to\n"
    "- The current state of the conversation (where things left off)\n"
    "\n"
    "Existing summary (if any):\n"
    "{existing_summary}\n"
    "\n"
    "New messages to fold into the summary:\n"
    "{messages_to_fold}\n"
    "\n"
    "Write a concise summary in short paragraphs grouped by topic. "
    "Not bullet points — narrative that flows.\n"
    "Be factual and specific. No pleasantries, no meta-commentary, "
    'no "the user and assistant discussed..."\n'
    "Write as if taking notes for a colleague who needs to pick up "
    "this conversation."
)

SUMMARY_USER_PREFIX = "[Prior conversation summary]\n"
SUMMARY_ASSISTANT_ACK = "Understood, I have context from our earlier conversation."

# -- Helpers ------------------------------------------------------------------


def build_summary_messages(summary: str) -> list[dict]:
    """Build the user/assistant summary pair to inject at the start of conversation."""
    return [
        {"role": "user", "content": SUMMARY_USER_PREFIX + summary},
        {"role": "assistant", "content": SUMMARY_ASSISTANT_ACK},
    ]


def is_summary_pair(messages: list[dict], index: int) -> bool:
    """Detect whether messages[index] and messages[index+1] form a summary pair."""
    if index + 1 >= len(messages):
        return False
    user_msg = messages[index]
    assistant_msg = messages[index + 1]
    if not user_msg or not assistant_msg:
        return False
    if user_msg.get("role") != "user" or assistant_msg.get("role") != "assistant":
        return False
    user_content = user_msg.get("content", "")
    assistant_content = assistant_msg.get("content", "")
    if not isinstance(user_content, str) or not isinstance(assistant_content, str):
        return False
    return (
        user_content.startswith(SUMMARY_USER_PREFIX) and assistant_content == SUMMARY_ASSISTANT_ACK
    )


def format_messages_for_prompt(messages: list[dict]) -> str:
    """Format messages as text for inclusion in the compaction prompt."""
    parts = []
    for m in messages:
        content = m.get("content", "")
        if not isinstance(content, str):
            try:
                content = json.dumps(content)
            except (TypeError, ValueError):
                content = str(content)
        parts.append(f"{m.get('role', 'unknown')}: {content}")
    return "\n\n".join(parts)


# -- Main function ------------------------------------------------------------


async def compact_if_needed(
    messages: list[dict],
    current_summary: str | None,
    config: NormalizedCompactionConfig,
    ctx: Any,
    agent_config: Any,
    step_key_prefix: str = "compaction",
) -> CompactionResult:
    """Compact conversation messages if they exceed the token budget.

    1. Estimate total tokens of all messages
    2. If under maxConversationTokens -> return as-is (no-op)
    3. Otherwise:
       - Find summary pair at start (if present)
       - Determine messages to fold (between summary pair and last minRecentMessages)
       - Call LLM to generate summary
       - If summary exceeds maxSummaryTokens, re-summarize
       - Replace folded messages + old summary pair with new summary pair
    4. On failure -> log warning, fall back to naive truncation
    """
    total_tokens = estimate_messages_tokens(messages)

    # Under budget - no-op
    if total_tokens <= config.max_conversation_tokens:
        return CompactionResult(
            compacted=False,
            messages=messages,
            summary=current_summary,
            summary_tokens=estimate_tokens(current_summary) if current_summary else 0,
            total_turns=len(messages),
        )

    # Determine summary pair boundaries
    summary_pair_end = 0
    if len(messages) >= 2 and is_summary_pair(messages, 0):
        summary_pair_end = 2

    # Messages available for folding: everything between summary pair and recent window
    recent_start = max(summary_pair_end, len(messages) - config.min_recent_messages)

    # Nothing to fold
    if recent_start <= summary_pair_end:
        return CompactionResult(
            compacted=False,
            messages=messages,
            summary=current_summary,
            summary_tokens=estimate_tokens(current_summary) if current_summary else 0,
            total_turns=len(messages),
        )

    messages_to_fold = messages[summary_pair_end:recent_start]
    recent_messages = messages[recent_start:]

    try:
        # Build the compaction prompt
        existing_summary = current_summary or "(none)"
        folded_text = format_messages_for_prompt(messages_to_fold)
        prompt = COMPACTION_PROMPT.replace("{existing_summary}", existing_summary).replace(
            "{messages_to_fold}", folded_text
        )

        # Call LLM via _llm_generate (reuses the agent's provider/model)
        summary = await _call_compaction_llm(ctx, agent_config, prompt, step_key_prefix)

        # Re-summarize if summary is too long
        if estimate_tokens(summary) > config.max_summary_tokens:
            re_summarize_prompt = COMPACTION_PROMPT.replace("{existing_summary}", "(none)").replace(
                "{messages_to_fold}",
                f"The following is a summary that needs to be shortened:\n\n{summary}",
            )
            summary = await _call_compaction_llm(
                ctx, agent_config, re_summarize_prompt, f"{step_key_prefix}:resummarize"
            )

        # Build new messages array: [summary pair] + [recent messages]
        summary_pair = build_summary_messages(summary)
        new_messages = summary_pair + recent_messages

        return CompactionResult(
            compacted=True,
            messages=new_messages,
            summary=summary,
            summary_tokens=estimate_tokens(summary),
            total_turns=len(messages),
        )
    except Exception as err:
        logger.warning("Compaction failed, falling back to naive truncation: %s", err)

        # Fallback: keep last minRecentMessages
        fallback_messages = messages[-config.min_recent_messages :]
        return CompactionResult(
            compacted=True,
            messages=fallback_messages,
            summary=current_summary,
            summary_tokens=estimate_tokens(current_summary) if current_summary else 0,
            total_turns=len(messages),
        )


async def _call_compaction_llm(
    ctx: Any, agent_config: Any, prompt: str, step_key_prefix: str
) -> str:
    """Call the agent's LLM to generate a compaction summary."""
    from ..llm import _llm_generate

    result = await _llm_generate(
        ctx,
        {
            "agent_run_id": ctx.execution_id,
            "agent_config": agent_config,
            "input": [{"role": "user", "content": prompt}],
            "agent_step": step_key_prefix,
        },
    )
    return result.get("content", "")
