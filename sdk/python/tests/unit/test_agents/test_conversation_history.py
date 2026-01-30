"""Unit tests for polos.agents.conversation_history module."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from polos.agents.conversation_history import (
    add_conversation_history,
    get_conversation_history,
)
from polos.runtime.client import PolosClient


class TestAddConversationHistory:
    """Tests for add_conversation_history function."""

    @pytest.mark.asyncio
    async def test_add_conversation_history_with_worker_client(self, mock_workflow_context):
        """Test add_conversation_history using worker client."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"
        role = "user"
        content = "Hello, world"

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
        ):
            await add_conversation_history(
                mock_workflow_context,
                conversation_id,
                agent_id,
                role,
                content,
            )

            mock_client.post.assert_called_once()
            call_args = mock_client.post.call_args
            # URL is first positional argument
            assert "internal/conversation" in call_args[0][0]
            # JSON is in keyword arguments
            assert call_args[1]["json"]["agent_id"] == agent_id
            assert call_args[1]["json"]["role"] == role
            assert call_args[1]["json"]["content"] == content

    @pytest.mark.asyncio
    async def test_add_conversation_history_without_worker_client(self, mock_workflow_context):
        """Test add_conversation_history without worker client (creates new client)."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"
        role = "assistant"
        content = {"message": "Response"}

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=None),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_client

            await add_conversation_history(
                mock_workflow_context,
                conversation_id,
                agent_id,
                role,
                content,
            )

            mock_client.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_add_conversation_history_with_agent_run_id(self, mock_workflow_context):
        """Test add_conversation_history with agent_run_id."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"
        role = "user"
        content = "Hello"
        agent_run_id = "test-run-123"

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
        ):
            await add_conversation_history(
                mock_workflow_context,
                conversation_id,
                agent_id,
                role,
                content,
                agent_run_id=agent_run_id,
            )

            call_args = mock_client.post.call_args
            assert call_args[1]["json"]["agent_run_id"] == agent_run_id

    @pytest.mark.asyncio
    async def test_add_conversation_history_with_custom_limit(self, mock_workflow_context):
        """Test add_conversation_history with custom conversation_history_limit."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"
        role = "user"
        content = "Hello"
        limit = 20

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
        ):
            await add_conversation_history(
                mock_workflow_context,
                conversation_id,
                agent_id,
                role,
                content,
                conversation_history_limit=limit,
            )

            call_args = mock_client.post.call_args
            assert call_args[1]["json"]["conversation_history_limit"] == limit


class TestGetConversationHistory:
    """Tests for get_conversation_history function."""

    @pytest.mark.asyncio
    async def test_get_conversation_history_with_worker_client(self):
        """Test get_conversation_history using worker client."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"
        mock_messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value={"messages": mock_messages})
        mock_client.get = AsyncMock(return_value=mock_response)

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
        ):
            result = await get_conversation_history(conversation_id, agent_id)

            assert result == mock_messages
            mock_client.get.assert_called_once()
            call_args = mock_client.get.call_args
            # URL is first positional argument
            assert "api/v1/conversation" in call_args[0][0]
            # Params are in keyword arguments
            assert call_args[1]["params"]["agent_id"] == agent_id

    @pytest.mark.asyncio
    async def test_get_conversation_history_without_worker_client(self):
        """Test get_conversation_history without worker client (creates new client)."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"
        mock_messages = [{"role": "user", "content": "Hello"}]

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value={"messages": mock_messages})

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=None),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_client

            result = await get_conversation_history(conversation_id, agent_id)

            assert result == mock_messages
            mock_client.get.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_conversation_history_with_deployment_id(self):
        """Test get_conversation_history with deployment_id parameter."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"
        deployment_id = "test-deployment"
        mock_messages = []

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value={"messages": mock_messages})
        mock_client.get = AsyncMock(return_value=mock_response)

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
        ):
            await get_conversation_history(conversation_id, agent_id, deployment_id=deployment_id)

            call_args = mock_client.get.call_args
            assert call_args[1]["params"]["deployment_id"] == deployment_id

    @pytest.mark.asyncio
    async def test_get_conversation_history_with_limit(self):
        """Test get_conversation_history with limit parameter."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"
        limit = 5
        mock_messages = []

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value={"messages": mock_messages})
        mock_client.get = AsyncMock(return_value=mock_response)

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
        ):
            await get_conversation_history(conversation_id, agent_id, limit=limit)

            call_args = mock_client.get.call_args
            assert call_args[1]["params"]["limit"] == limit

    @pytest.mark.asyncio
    async def test_get_conversation_history_with_empty_messages(self):
        """Test get_conversation_history when response has no messages key."""
        conversation_id = "test-conversation"
        agent_id = "test-agent"

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value={})  # No messages key
        mock_client.get = AsyncMock(return_value=mock_response)

        mock_polos_client = PolosClient(
            api_url="http://localhost:8080", api_key="test", project_id="test"
        )
        with (
            patch("polos.agents.conversation_history.get_worker_client", return_value=mock_client),
            patch(
                "polos.agents.conversation_history.get_client_or_raise",
                return_value=mock_polos_client,
            ),
            patch.object(mock_polos_client, "_get_headers", return_value={}),
        ):
            result = await get_conversation_history(conversation_id, agent_id)

            assert result == []  # Should return empty list when no messages key
