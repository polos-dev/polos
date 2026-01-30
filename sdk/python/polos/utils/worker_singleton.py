"""Singleton worker instance management for HTTP client reuse."""

from typing import Any

import httpx

# Singleton worker instance (set by Worker when it starts)
_current_worker: Any | None = None


def get_worker_client() -> httpx.AsyncClient | None:
    """Get the HTTP client from the current worker instance if available.

    Returns:
        The worker's HTTP client if a worker is running, None otherwise
    """
    global _current_worker
    if _current_worker is not None and _current_worker.client is not None:
        return _current_worker.client
    return None


def set_current_worker(worker: Any | None) -> None:
    """Set the current worker instance (called by Worker when it starts/stops).

    Args:
        worker: The Worker instance, or None to clear
    """
    global _current_worker
    _current_worker = worker


def get_current_worker() -> Any | None:
    """Get the current worker instance if available.

    Returns:
        The current Worker instance, or None if no worker is running
    """
    global _current_worker
    return _current_worker
