"""Client context utilities for getting PolosClient from worker context."""

from typing import TYPE_CHECKING

from .worker_singleton import get_current_worker

if TYPE_CHECKING:
    from ..runtime.client import PolosClient


def get_client_from_context() -> "PolosClient | None":
    """Get PolosClient from current worker context.

    Returns:
        PolosClient instance if available, None otherwise
    """
    worker = get_current_worker()
    if worker and hasattr(worker, "client"):
        # Import here to avoid circular dependency
        from ..runtime.client import PolosClient

        if isinstance(worker.polos_client, PolosClient):
            return worker.polos_client
    return None


def get_client_or_raise() -> "PolosClient":
    """Get PolosClient from context or raise error.

    Returns:
        PolosClient instance from worker context

    Raises:
        RuntimeError: If no PolosClient is available in context
    """
    client = get_client_from_context()
    if client is None:
        raise RuntimeError(
            "No PolosClient available. Pass client parameter or run in Worker context."
        )
    return client
