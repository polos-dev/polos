"""Utility functions for conversation history management."""

from typing import Any
from urllib.parse import quote

import httpx

from ..runtime.client import _config, _get_headers
from ..utils.worker_singleton import get_worker_client


async def add_conversation_history(
    ctx: Any,  # WorkflowContext
    conversation_id: str,
    agent_id: str,
    role: str,
    content: Any,
    agent_run_id: str | None = None,
    conversation_history_limit: int = 10,
) -> None:
    """Add a message to conversation history with durable execution.

    Args:
        ctx: WorkflowContext for durable execution
        conversation_id: Conversation identifier
        agent_id: Agent identifier
        role: Message role ("user" or "assistant")
        content: Message content (will be JSON-serialized)
        agent_run_id: Optional agent run ID for traceability
        conversation_history_limit: Maximum number of messages to keep (default: 10)
    """
    # Content should be JSON-serializable (string, dict, list, etc.)
    # Pass content as-is - httpx will serialize it to JSON
    content_json = content

    api_url = _config["api_url"]
    headers = _get_headers()

    request_json = {
        "agent_id": agent_id,
        "role": role,
        "content": content_json,
        "conversation_history_limit": conversation_history_limit,
    }
    if agent_run_id:
        request_json["agent_run_id"] = agent_run_id

    # Try to reuse worker's HTTP client if available
    worker_client = get_worker_client()

    encoded_conversation_id = quote(conversation_id, safe="")
    if worker_client is not None:
        response = await worker_client.post(
            f"{api_url}/internal/conversation/{encoded_conversation_id}/add",
            json=request_json,
            headers=headers,
        )
        response.raise_for_status()
    else:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{api_url}/internal/conversation/{encoded_conversation_id}/add",
                json=request_json,
                headers=headers,
            )
            response.raise_for_status()


async def get_conversation_history(
    conversation_id: str,
    agent_id: str,
    deployment_id: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Get conversation history for a conversation.

    Args:
        conversation_id: Conversation identifier
        agent_id: Agent identifier (required)
        deployment_id: Optional deployment identifier
        limit: Optional limit on number of messages to return

    Returns:
        List of conversation messages (oldest first)
    """
    api_url = _config["api_url"]
    headers = _get_headers()

    params = {
        "agent_id": agent_id,
    }
    if deployment_id is not None:
        params["deployment_id"] = deployment_id
    if limit is not None:
        params["limit"] = limit

    # Try to reuse worker's HTTP client if available
    worker_client = get_worker_client()

    encoded_conversation_id = quote(conversation_id, safe="")
    if worker_client is not None:
        response = await worker_client.get(
            f"{api_url}/api/v1/conversation/{encoded_conversation_id}/get",
            params=params,
            headers=headers,
        )
        response.raise_for_status()
        result = response.json()
        return result.get("messages", [])
    else:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{api_url}/api/v1/conversation/{encoded_conversation_id}/get",
                params=params,
                headers=headers,
            )
            response.raise_for_status()
            result = response.json()
            return result.get("messages", [])
