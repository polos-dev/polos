"""Security utilities for the execution framework.

Provides allowlist evaluation for command security and path safety
checks for file operations.
"""

from __future__ import annotations

import os
import re


def match_glob(text: str, pattern: str) -> bool:
    """Match a text string against a simple glob pattern.

    Supports ``*`` as a wildcard that matches any sequence of characters.

    Args:
        text: The text to match.
        pattern: Glob pattern with ``*`` wildcards.

    Returns:
        Whether the text matches the pattern.
    """
    # Escape regex special chars except *, then convert * to .*
    escaped = re.sub(r"[.+?^${}()|[\]\\]", lambda m: "\\" + m.group(), pattern)
    regex_str = f"^{escaped.replace('*', '.*')}$"
    return bool(re.match(regex_str, text))


def evaluate_allowlist(command: str, patterns: list[str]) -> bool:
    """Evaluate a command against an allowlist of glob patterns.

    Matches the full command string against each pattern.
    Patterns support ``*`` wildcards (e.g., ``node *``, ``npm *``, ``*``).

    Args:
        command: The shell command to check.
        patterns: Array of glob patterns to match against.

    Returns:
        Whether the command matches any pattern in the allowlist.
    """
    trimmed = command.strip()
    return any(match_glob(trimmed, pattern) for pattern in patterns)


def is_within_restriction(resolved_path: str, restriction: str) -> bool:
    """Check whether a resolved path stays within a restriction directory.

    Args:
        resolved_path: The fully resolved path to check.
        restriction: The base directory the path must stay within.

    Returns:
        Whether the path is within the restriction.
    """
    base = os.path.abspath(restriction)
    return resolved_path == base or resolved_path.startswith(base + os.sep)


def assert_safe_path(file_path: str, restriction: str) -> None:
    """Assert that a file path stays within a restriction directory.

    Throws if path traversal is detected.

    Args:
        file_path: The file path to check.
        restriction: The base directory paths must stay within.

    Raises:
        ValueError: If the resolved path escapes the restriction directory.
    """
    base = os.path.abspath(restriction)
    resolved = os.path.abspath(os.path.join(base, file_path))

    if not is_within_restriction(resolved, base):
        raise ValueError(
            f'Path traversal detected: "{file_path}" resolves outside of "{restriction}"'
        )
