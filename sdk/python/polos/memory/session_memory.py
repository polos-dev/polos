"""Session memory API functions for loading/storing session memory."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from ..utils.client_context import get_client_or_raise
from ..utils.worker_singleton import get_worker_client
from .types import SessionMemory


async def get_session_memory(session_id: str) -> SessionMemory:
    """Get session memory (summary + messages).

    GET /internal/session/{session_id}/memory

    Args:
        session_id: Session identifier

    Returns:
        SessionMemory with summary and messages
    """
    polos_client = get_client_or_raise()
    api_url = polos_client.api_url
    headers = polos_client._get_headers()

    encoded_session_id = quote(session_id, safe="")
    worker_client = get_worker_client()

    if worker_client is not None:
        response = await worker_client.get(
            f"{api_url}/internal/session/{encoded_session_id}/memory",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
    else:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{api_url}/internal/session/{encoded_session_id}/memory",
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

    return SessionMemory(
        summary=data.get("summary"),
        messages=data.get("messages", []),
    )


async def put_session_memory(
    session_id: str,
    summary: str | None,
    messages: list[dict[str, Any]],
) -> None:
    """Store session memory (summary + messages).

    PUT /internal/session/{session_id}/memory

    Args:
        session_id: Session identifier
        summary: Current compacted summary (or None)
        messages: Recent conversation messages to store
    """
    polos_client = get_client_or_raise()
    api_url = polos_client.api_url
    headers = polos_client._get_headers()

    encoded_session_id = quote(session_id, safe="")
    request_json = {
        "summary": summary,
        "messages": messages,
    }

    worker_client = get_worker_client()

    if worker_client is not None:
        response = await worker_client.put(
            f"{api_url}/internal/session/{encoded_session_id}/memory",
            json=request_json,
            headers=headers,
        )
        response.raise_for_status()
    else:
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{api_url}/internal/session/{encoded_session_id}/memory",
                json=request_json,
                headers=headers,
            )
            response.raise_for_status()
