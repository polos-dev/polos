"""Unit tests for PolosClient class."""

import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from polos.runtime.client import ExecutionHandle, PolosClient


class TestPolosClientInitialization:
    """Tests for PolosClient initialization."""

    def test_init_with_explicit_params(self):
        """Test initialization with explicit parameters."""
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )
        assert client.api_url == "http://test.example.com"
        assert client.api_key == "test-key"
        assert client.project_id == "test-project"

    def test_init_falls_back_to_env_vars(self):
        """Test initialization falls back to environment variables."""
        with patch.dict(
            os.environ,
            {
                "POLOS_API_URL": "http://env.example.com",
                "POLOS_API_KEY": "env-key",
                "POLOS_PROJECT_ID": "env-project",
            },
        ):
            client = PolosClient()
            assert client.api_url == "http://env.example.com"
            assert client.api_key == "env-key"
            assert client.project_id == "env-project"

    def test_init_defaults_to_localhost(self):
        """Test initialization defaults to localhost when no env var."""
        with patch.dict(os.environ, {}, clear=True):
            # Remove POLOS_API_URL if it exists
            os.environ.pop("POLOS_API_URL", None)
            os.environ.pop("POLOS_API_KEY", None)
            os.environ.pop("POLOS_PROJECT_ID", None)
            os.environ.pop("POLOS_LOCAL_MODE", None)

            with pytest.raises(ValueError, match="api_key is required"):
                PolosClient()

    def test_init_requires_api_key(self):
        """Test initialization requires api_key unless in local mode."""
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("POLOS_API_KEY", None)
            os.environ.pop("POLOS_LOCAL_MODE", None)

            with pytest.raises(ValueError, match="api_key is required"):
                PolosClient(api_url="http://test.example.com", project_id="test-project")

    def test_init_requires_project_id(self):
        """Test initialization requires project_id."""
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("POLOS_PROJECT_ID", None)

            with pytest.raises(ValueError, match="project_id is required"):
                PolosClient(api_url="http://test.example.com", api_key="test-key")

    def test_init_allows_local_mode_with_localhost(self):
        """Test initialization allows missing api_key in local mode with localhost."""
        with patch.dict(os.environ, {"POLOS_LOCAL_MODE": "true"}, clear=True):
            os.environ.pop("POLOS_API_KEY", None)

            client = PolosClient(
                api_url="http://localhost:8080",
                project_id="test-project",
            )
            assert client.api_url == "http://localhost:8080"
            assert client.api_key is None
            assert client.project_id == "test-project"

    def test_init_warns_local_mode_with_non_localhost(self):
        """Test initialization warns when local mode is set but URL is not localhost."""
        with (
            patch.dict(os.environ, {"POLOS_LOCAL_MODE": "true"}),
            patch("polos.runtime.client.logger") as mock_logger,
        ):
            with pytest.raises(ValueError, match="api_key is required"):
                PolosClient(
                    api_url="http://test.example.com",
                    project_id="test-project",
                )
            # Check that warning was logged
            mock_logger.warning.assert_called()


class TestPolosClientGetHeaders:
    """Tests for _get_headers method."""

    def test_get_headers_includes_content_type(self):
        """Test _get_headers includes Content-Type."""
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )
        headers = client._get_headers()
        assert headers["Content-Type"] == "application/json"

    def test_get_headers_includes_authorization(self):
        """Test _get_headers includes Authorization header when not in local mode."""
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )
        headers = client._get_headers()
        assert headers["Authorization"] == "Bearer test-key"

    def test_get_headers_includes_project_id(self):
        """Test _get_headers includes X-Project-ID header."""
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )
        headers = client._get_headers()
        assert headers["X-Project-ID"] == "test-project"

    def test_get_headers_excludes_authorization_in_local_mode(self):
        """Test _get_headers excludes Authorization in local mode."""
        with patch.dict(os.environ, {"POLOS_LOCAL_MODE": "true"}):
            client = PolosClient(
                api_url="http://localhost:8080",
                project_id="test-project",
            )
            headers = client._get_headers()
            assert "Authorization" not in headers
            assert headers["X-Project-ID"] == "test-project"

    def test_get_headers_raises_on_missing_api_key(self):
        """Test _get_headers raises ValueError when api_key is missing."""
        # Create client with api_key, then remove it to test _get_headers
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )
        # Remove api_key after initialization
        client.api_key = None
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("POLOS_API_KEY", None)
            os.environ.pop("POLOS_LOCAL_MODE", None)
            with pytest.raises(ValueError, match="api_key is required"):
                client._get_headers()

    def test_get_headers_raises_on_missing_project_id(self):
        """Test _get_headers raises ValueError when project_id is missing."""
        # Create client with project_id, then remove it to test _get_headers
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )
        # Remove project_id after initialization
        client.project_id = None
        with pytest.raises(ValueError, match="project_id is required"):
            client._get_headers()


class TestPolosClientGetHttpClient:
    """Tests for _get_http_client method."""

    @pytest.mark.asyncio
    async def test_get_http_client_reuses_worker_client(self):
        """Test _get_http_client reuses worker's HTTP client when available."""
        mock_worker_client = AsyncMock(spec=httpx.AsyncClient)
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        with patch("polos.runtime.client.get_worker_client", return_value=mock_worker_client):
            http_client = await client._get_http_client()
            assert http_client is mock_worker_client

    @pytest.mark.asyncio
    async def test_get_http_client_creates_new_client(self):
        """Test _get_http_client creates new client when worker client unavailable."""
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        with patch("polos.runtime.client.get_worker_client", return_value=None):
            http_client = await client._get_http_client()
            assert isinstance(http_client, httpx.AsyncClient)
            await http_client.aclose()

    @pytest.mark.asyncio
    async def test_get_http_client_respects_timeout(self):
        """Test _get_http_client respects timeout parameter."""
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        with patch("polos.runtime.client.get_worker_client", return_value=None):
            timeout = httpx.Timeout(60.0)
            http_client = await client._get_http_client(timeout=timeout)
            assert isinstance(http_client, httpx.AsyncClient)
            await http_client.aclose()


class TestPolosClientInvoke:
    """Tests for invoke method."""

    @pytest.mark.asyncio
    async def test_invoke_calls_submit_workflow(self):
        """Test invoke calls _submit_workflow with correct parameters."""
        execution_id = str(uuid.uuid4())
        workflow_id = "test-workflow"
        payload = {"key": "value"}

        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_handle = ExecutionHandle(
            id=execution_id,
            workflow_id=workflow_id,
        )

        with patch.object(
            client, "_submit_workflow", new_callable=AsyncMock, return_value=mock_handle
        ) as mock_submit:
            handle = await client.invoke(
                workflow_id=workflow_id,
                payload=payload,
                queue_name="test-queue",
                session_id="test-session",
            )

            mock_submit.assert_called_once()
            call_kwargs = mock_submit.call_args[1]
            assert call_kwargs["workflow_id"] == workflow_id
            assert call_kwargs["payload"] == payload
            assert call_kwargs["queue_name"] == "test-queue"
            assert call_kwargs["session_id"] == "test-session"
            assert call_kwargs["deployment_id"] is None
            assert handle == mock_handle

    @pytest.mark.asyncio
    async def test_invoke_returns_execution_handle(self):
        """Test invoke returns ExecutionHandle."""
        execution_id = str(uuid.uuid4())
        workflow_id = "test-workflow"

        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_handle = ExecutionHandle(
            id=execution_id,
            workflow_id=workflow_id,
        )

        with patch.object(
            client, "_submit_workflow", new_callable=AsyncMock, return_value=mock_handle
        ):
            handle = await client.invoke(workflow_id=workflow_id)
            assert isinstance(handle, ExecutionHandle)
            assert handle.id == execution_id


class TestPolosClientBatchInvoke:
    """Tests for batch_invoke method."""

    @pytest.mark.asyncio
    async def test_batch_invoke_calls_submit_workflows(self):
        """Test batch_invoke calls _submit_workflows with correct data."""
        from polos.types.types import BatchWorkflowInput

        execution_id1 = str(uuid.uuid4())
        execution_id2 = str(uuid.uuid4())
        workflow_id = "test-workflow"

        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_handle1 = ExecutionHandle(id=execution_id1, workflow_id=workflow_id)
        mock_handle2 = ExecutionHandle(id=execution_id2, workflow_id=workflow_id)

        workflows = [
            BatchWorkflowInput(id=workflow_id, payload={"key1": "value1"}),
            BatchWorkflowInput(id=workflow_id, payload={"key2": "value2"}),
        ]

        with (
            patch("polos.core.workflow.get_workflow") as mock_get_workflow,
            patch.object(
                client,
                "_submit_workflows",
                new_callable=AsyncMock,
                return_value=[mock_handle1, mock_handle2],
            ) as mock_submit,
        ):
            # Mock workflow registry
            mock_workflow = MagicMock()
            mock_workflow.queue_name = None
            mock_workflow.queue_concurrency_limit = None
            mock_get_workflow.return_value = mock_workflow

            handles = await client.batch_invoke(workflows, session_id="test-session")

            mock_submit.assert_called_once()
            call_kwargs = mock_submit.call_args[1]
            assert call_kwargs["session_id"] == "test-session"
            assert len(call_kwargs["workflows"]) == 2
            assert len(handles) == 2
            assert handles[0] == mock_handle1
            assert handles[1] == mock_handle2

    @pytest.mark.asyncio
    async def test_batch_invoke_returns_empty_list(self):
        """Test batch_invoke returns empty list for empty input."""
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        handles = await client.batch_invoke([])
        assert handles == []

    @pytest.mark.asyncio
    async def test_batch_invoke_raises_on_unknown_workflow(self):
        """Test batch_invoke raises ValueError for unknown workflow."""
        from polos.types.types import BatchWorkflowInput

        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        workflows = [BatchWorkflowInput(id="unknown-workflow", payload={})]

        with (
            patch("polos.core.workflow.get_workflow", return_value=None),
            pytest.raises(ValueError, match="Workflow 'unknown-workflow' not found"),
        ):
            await client.batch_invoke(workflows)


class TestPolosClientResume:
    """Tests for resume method."""

    @pytest.mark.asyncio
    async def test_resume_publishes_event(self):
        """Test resume publishes resume event with correct topic."""
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        suspend_execution_id = str(uuid.uuid4())
        suspend_step_key = "test-step"
        data = {"key": "value"}

        with patch("polos.features.events.batch_publish", new_callable=AsyncMock) as mock_publish:
            await client.resume(suspend_execution_id, suspend_step_key, data)

            mock_publish.assert_called_once()
            call_kwargs = mock_publish.call_args[1]
            assert call_kwargs["topic"] == f"{suspend_step_key}/{suspend_execution_id}"
            assert call_kwargs["client"] == client
            events = call_kwargs["events"]
            assert len(events) == 1
            assert events[0].event_type == "resume"
            assert events[0].data == data


class TestPolosClientGetExecution:
    """Tests for get_execution method."""

    @pytest.mark.asyncio
    async def test_get_execution_uses_worker_client(self):
        """Test get_execution uses worker's HTTP client when available."""
        execution_id = str(uuid.uuid4())
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_worker_client = AsyncMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={"id": execution_id, "status": "completed"})
        mock_response.raise_for_status = MagicMock()
        mock_worker_client.get = AsyncMock(return_value=mock_response)

        with (
            patch("polos.runtime.client.get_worker_client", return_value=mock_worker_client),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
        ):
            result = await client.get_execution(execution_id)

            mock_worker_client.get.assert_called_once()
            assert result["id"] == execution_id
            assert result["status"] == "completed"

    @pytest.mark.asyncio
    async def test_get_execution_creates_new_client(self):
        """Test get_execution creates new client when worker client unavailable."""
        execution_id = str(uuid.uuid4())
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={"id": execution_id, "status": "completed"})
        mock_response.raise_for_status = MagicMock()

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_http_client = AsyncMock()
            mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
            mock_http_client.__aexit__ = AsyncMock(return_value=None)
            mock_http_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value = mock_http_client

            result = await client.get_execution(execution_id)

            mock_http_client.get.assert_called_once()
            assert result["id"] == execution_id


class TestPolosClientCancelExecution:
    """Tests for cancel_execution method."""

    @pytest.mark.asyncio
    async def test_cancel_execution_returns_true_on_success(self):
        """Test cancel_execution returns True on successful cancellation."""
        execution_id = str(uuid.uuid4())
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_worker_client = AsyncMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_worker_client.post = AsyncMock(return_value=mock_response)

        with (
            patch("polos.runtime.client.get_worker_client", return_value=mock_worker_client),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
        ):
            result = await client.cancel_execution(execution_id)

            assert result is True
            mock_worker_client.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_cancel_execution_returns_false_on_404(self):
        """Test cancel_execution returns False when execution not found."""
        execution_id = str(uuid.uuid4())
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_worker_client = AsyncMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_worker_client.post = AsyncMock(return_value=mock_response)

        with (
            patch("polos.runtime.client.get_worker_client", return_value=mock_worker_client),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
        ):
            result = await client.cancel_execution(execution_id)

            assert result is False

    @pytest.mark.asyncio
    async def test_cancel_execution_handles_http_errors(self):
        """Test cancel_execution handles HTTP errors gracefully."""
        execution_id = str(uuid.uuid4())
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_worker_client = AsyncMock(spec=httpx.AsyncClient)
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                "Server error", request=MagicMock(), response=mock_response
            )
        )
        mock_worker_client.post = AsyncMock(return_value=mock_response)

        with (
            patch("polos.runtime.client.get_worker_client", return_value=mock_worker_client),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
        ):
            result = await client.cancel_execution(execution_id)

            assert result is False

    @pytest.mark.asyncio
    async def test_cancel_execution_closes_new_client(self):
        """Test cancel_execution closes new client after use."""
        execution_id = str(uuid.uuid4())
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_http_client.aclose = AsyncMock()

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
            patch("httpx.AsyncClient", return_value=mock_http_client),
        ):
            await client.cancel_execution(execution_id)

            mock_http_client.aclose.assert_called_once()


class TestPolosClientSubmitWorkflow:
    """Tests for _submit_workflow method."""

    @pytest.mark.asyncio
    async def test_submit_workflow_constructs_correct_request(self):
        """Test _submit_workflow constructs correct request JSON."""
        execution_id = str(uuid.uuid4())
        workflow_id = "test-workflow"
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_response = MagicMock()
        mock_response.json = MagicMock(
            return_value={
                "execution_id": execution_id,
                "created_at": "2024-01-01T00:00:00Z",
            }
        )
        mock_response.raise_for_status = MagicMock()

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_http_client.aclose = AsyncMock()

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
            patch("httpx.AsyncClient", return_value=mock_http_client),
        ):
            handle = await client._submit_workflow(
                workflow_id=workflow_id,
                payload={"key": "value"},
                queue_name="test-queue",
                session_id="test-session",
            )

            mock_http_client.post.assert_called_once()
            call_args = mock_http_client.post.call_args
            assert call_args[0][0] == f"{client.api_url}/api/v1/workflows/{workflow_id}/run"
            request_json = call_args[1]["json"]
            assert request_json["payload"] == {"key": "value"}
            assert request_json["queue_name"] == "test-queue"
            assert request_json["session_id"] == "test-session"
            assert request_json["wait_for_subworkflow"] is False
            assert isinstance(handle, ExecutionHandle)
            assert handle.id == execution_id

    @pytest.mark.asyncio
    async def test_submit_workflow_validates_state_size(self):
        """Test _submit_workflow validates initial_state size."""
        workflow_id = "test-workflow"
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        # Create a state that's too large (> 1MB)
        large_state = {"data": "x" * (2 * 1024 * 1024)}  # 2MB

        with pytest.raises(ValueError, match="exceeds maximum allowed size"):
            await client._submit_workflow(
                workflow_id=workflow_id,
                payload={},
                initial_state=large_state,
            )

    @pytest.mark.asyncio
    async def test_submit_workflow_inherits_session_id_from_context(self):
        """Test _submit_workflow inherits session_id from execution context."""
        execution_id = str(uuid.uuid4())
        workflow_id = "test-workflow"
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={"execution_id": execution_id})
        mock_response.raise_for_status = MagicMock()

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_http_client.aclose = AsyncMock()

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
            patch("httpx.AsyncClient", return_value=mock_http_client),
            patch("polos.core.workflow._execution_context") as mock_context,
        ):
            mock_context.get.return_value = {
                "session_id": "context-session",
                "user_id": "context-user",
            }

            await client._submit_workflow(workflow_id=workflow_id, payload={})

            call_args = mock_http_client.post.call_args
            request_json = call_args[1]["json"]
            assert request_json["session_id"] == "context-session"
            assert request_json["user_id"] == "context-user"


class TestPolosClientSubmitWorkflows:
    """Tests for _submit_workflows method."""

    @pytest.mark.asyncio
    async def test_submit_workflows_constructs_batch_request(self):
        """Test _submit_workflows constructs correct batch request."""
        execution_id1 = str(uuid.uuid4())
        execution_id2 = str(uuid.uuid4())
        client = PolosClient(
            api_url="http://test.example.com",
            api_key="test-key",
            project_id="test-project",
        )

        mock_response = MagicMock()
        mock_response.json = MagicMock(
            return_value={
                "executions": [
                    {"execution_id": execution_id1, "created_at": "2024-01-01T00:00:00Z"},
                    {"execution_id": execution_id2, "created_at": "2024-01-01T00:00:00Z"},
                ]
            }
        )
        mock_response.raise_for_status = MagicMock()

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        mock_http_client.aclose = AsyncMock()

        workflows = [
            {"workflow_id": "workflow1", "payload": {"key1": "value1"}},
            {"workflow_id": "workflow2", "payload": {"key2": "value2"}},
        ]

        with (
            patch("polos.runtime.client.get_worker_client", return_value=None),
            patch.object(client, "_get_headers", return_value={"Authorization": "Bearer test-key"}),
            patch("httpx.AsyncClient", return_value=mock_http_client),
        ):
            handles = await client._submit_workflows(
                workflows=workflows,
                session_id="test-session",
            )

            mock_http_client.post.assert_called_once()
            call_args = mock_http_client.post.call_args
            assert call_args[0][0] == f"{client.api_url}/api/v1/workflows/batch_run"
            request_json = call_args[1]["json"]
            assert len(request_json["workflows"]) == 2
            assert request_json["session_id"] == "test-session"
            assert len(handles) == 2
            assert all(isinstance(h, ExecutionHandle) for h in handles)
