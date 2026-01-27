"""Retry utilities with exponential backoff."""

import asyncio
from collections.abc import Callable
from typing import Any


async def retry_with_backoff(
    func: Callable,
    max_retries: int = 2,
    base_delay: float = 1.0,
    max_delay: float = 10.0,
    *args,
    **kwargs,
) -> Any:
    """
    Retry a function with exponential backoff.

    Args:
        func: Async function to retry
        max_retries: Maximum number of retries (default: 2)
        base_delay: Base delay in seconds for exponential backoff (default: 1.0)
        max_delay: Maximum delay in seconds (default: 10.0)
        *args: Positional arguments to pass to func
        **kwargs: Keyword arguments to pass to func

    Returns:
        Result from func

    Raises:
        Exception: If all retries are exhausted
    """
    last_exception = None
    for attempt in range(max_retries + 1):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            last_exception = e
            if attempt <= max_retries:
                # Calculate delay with exponential backoff
                delay = min(base_delay * (2**attempt), max_delay)
                await asyncio.sleep(delay)
            else:
                # All retries exhausted
                raise last_exception from None
    # Should never reach here, but just in case
    raise last_exception from None
