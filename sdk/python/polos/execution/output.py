"""Output utilities for the execution framework.

Provides functions for truncating large outputs, detecting binary content,
parsing grep output, and stripping ANSI escape codes.
"""

from __future__ import annotations

import re

from .types import GrepMatch

# Default maximum output characters
DEFAULT_MAX_CHARS = 100_000

# Head portion of truncated output (20% of max)
HEAD_RATIO = 0.2


def truncate_output(output: str, max_chars: int | None = None) -> tuple[str, bool]:
    """Truncate output that exceeds the maximum character limit.

    Keeps the first 20% characters (head) and last 80% characters (tail)
    of the max, with a truncation message in between.

    Args:
        output: The output string to potentially truncate.
        max_chars: Maximum character limit (default: 100,000).

    Returns:
        A tuple of (text, truncated) where truncated is True if output was truncated.
    """
    max_c = max_chars if max_chars is not None else DEFAULT_MAX_CHARS
    if len(output) <= max_c:
        return output, False

    head_size = int(max_c * HEAD_RATIO)
    tail_size = max_c - head_size
    omitted = len(output) - head_size - tail_size

    head = output[:head_size]
    tail = output[-tail_size:]
    text = f"{head}\n\n--- truncated {omitted} characters ---\n\n{tail}"

    return text, True


def is_binary(data: bytes) -> bool:
    """Detect binary content by checking for null bytes in the first 8KB.

    Args:
        data: The raw bytes to check.

    Returns:
        True if binary content is detected.
    """
    check_length = min(len(data), 8192)
    return any(data[i] == 0 for i in range(check_length))


def parse_grep_output(output: str) -> list[GrepMatch]:
    """Parse ``grep -rn`` output into structured GrepMatch objects.

    Expected format: ``filepath:linenum:matched text``

    Args:
        output: Raw grep output string.

    Returns:
        List of GrepMatch objects.
    """
    if not output.strip():
        return []

    matches: list[GrepMatch] = []
    pattern = re.compile(r"^(.+?):(\d+):(.*)$")

    for line in output.split("\n"):
        if not line:
            continue

        m = pattern.match(line)
        if m:
            matches.append(
                GrepMatch(
                    path=m.group(1),
                    line=int(m.group(2)),
                    text=m.group(3),
                )
            )

    return matches


def strip_ansi(text: str) -> str:
    """Strip ANSI escape codes from text.

    Args:
        text: Text potentially containing ANSI escape sequences.

    Returns:
        Cleaned text without ANSI codes.
    """
    return re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", text)
