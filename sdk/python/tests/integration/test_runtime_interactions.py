"""Integration tests for runtime client interactions."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from polos.runtime.client import ExecutionHandle, PolosClient


class TestRuntimeClient:
    """Integration tests for runtime client interactions."""

    @pytest.mark.asyncio
    async def test_submit_workflow(self):
        """Test submitting a workflow to the orchestrator."""
        execution_id = str(uuid.uuid4())
        workflow_id = "test-workflow"

        mock_response = MagicMock()
        mock_response.json = MagicMock(
            return_value={
                "execution_id": execution_id,
                "workflow_id": workflow_id,
                "status": "running",
            }
        )
        mock_response.raise_for_status = MagicMock()

        client = PolosClient(
            api_url="http://localhost:8080",
            api_key="test-key",
            project_id="test-project",
        )

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch.object(
                client,
                "_get_headers",
                return_value={"Authorization": "Bearer test-key"},
            ),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_http_client = AsyncMock()
            mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
            mock_http_client.__aexit__ = AsyncMock(return_value=None)
            mock_http_client.post = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_http_client

            handle = await client._submit_workflow(
                workflow_id=workflow_id,
                payload={"test": "data"},
                session_id="test-session",
            )

            assert isinstance(handle, ExecutionHandle)
            assert handle.id == execution_id
            assert handle.workflow_id == workflow_id

    @pytest.mark.asyncio
    async def test_get_execution(self):
        """Test getting execution from orchestrator."""
        execution_id = str(uuid.uuid4())

        mock_response = MagicMock()
        mock_response.json = MagicMock(
            return_value={
                "id": execution_id,
                "status": "completed",
                "result": {"output": "test"},
            }
        )
        mock_response.raise_for_status = MagicMock()

        client = PolosClient(
            api_url="http://localhost:8080",
            api_key="test-key",
            project_id="test-project",
        )

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch.object(
                client,
                "_get_headers",
                return_value={"Authorization": "Bearer test-key"},
            ),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_http_client = AsyncMock()
            mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
            mock_http_client.__aexit__ = AsyncMock(return_value=None)
            mock_http_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_http_client

            execution = await client.get_execution(execution_id)

            assert execution["id"] == execution_id
            assert execution["status"] == "completed"
            assert execution["result"] == {"output": "test"}

    @pytest.mark.asyncio
    async def test_execution_handle_to_dict(self):
        """Test ExecutionHandle.to_dict()."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        handle = ExecutionHandle(
            id=execution_id,
            workflow_id="test-workflow",
            root_execution_id=root_execution_id,
            session_id="test-session",
        )

        result = handle.to_dict()

        assert result["id"] == execution_id
        assert result["workflow_id"] == "test-workflow"
        assert result["root_execution_id"] == root_execution_id
        assert result["session_id"] == "test-session"

    @pytest.mark.asyncio
    async def test_store_step_output(self):
        """Test storing step output via runtime client."""
        from polos.runtime.client import store_step_output

        execution_id = str(uuid.uuid4())
        step_key = "test_step"

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        client = PolosClient(
            api_url="http://localhost:8080",
            api_key="test-key",
            project_id="test-project",
        )

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch("polos.runtime.client.get_client_or_raise", return_value=client),
            patch.object(
                client,
                "_get_headers",
                return_value={"Authorization": "Bearer test-key"},
            ),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_http_client = AsyncMock()
            mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
            mock_http_client.__aexit__ = AsyncMock(return_value=None)
            mock_http_client.post = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_http_client

            await store_step_output(
                execution_id=execution_id,
                step_key=step_key,
                outputs={"result": "test"},
            )

            mock_http_client.post.assert_called_once()
            call_args = mock_http_client.post.call_args
            assert f"/internal/executions/{execution_id}/steps" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_get_step_output(self):
        """Test getting step output via runtime client."""
        from polos.runtime.client import get_step_output

        execution_id = str(uuid.uuid4())
        step_key = "test_step"

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={"output": {"result": "test"}})
        mock_response.raise_for_status = MagicMock()

        client = PolosClient(
            api_url="http://localhost:8080",
            api_key="test-key",
            project_id="test-project",
        )

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch("polos.runtime.client.get_client_or_raise", return_value=client),
            patch.object(
                client,
                "_get_headers",
                return_value={"Authorization": "Bearer test-key"},
            ),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_http_client = AsyncMock()
            mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
            mock_http_client.__aexit__ = AsyncMock(return_value=None)
            mock_http_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_http_client

            output = await get_step_output(execution_id=execution_id, step_key=step_key)

            assert output == {"output": {"result": "test"}}

    @pytest.mark.asyncio
    async def test_cancel_execution(self):
        """Test canceling an execution."""
        execution_id = str(uuid.uuid4())

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        client = PolosClient(
            api_url="http://localhost:8080",
            api_key="test-key",
            project_id="test-project",
        )

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch.object(
                client,
                "_get_headers",
                return_value={"Authorization": "Bearer test-key"},
            ),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_http_client = AsyncMock()
            mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
            mock_http_client.__aexit__ = AsyncMock(return_value=None)
            mock_http_client.post = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_http_client

            result = await client.cancel_execution(execution_id=execution_id)

            assert result is True
            mock_http_client.post.assert_called_once()
            call_args = mock_http_client.post.call_args
            assert f"/api/v1/executions/{execution_id}/cancel" in call_args[0][0]
