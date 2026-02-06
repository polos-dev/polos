import json
import logging
import os
from typing import Any

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel

from ..types.types import AgentResult, BatchWorkflowInput
from ..utils.client_context import get_client_or_raise
from ..utils.config import is_localhost_url
from ..utils.worker_singleton import get_worker_client

logger = logging.getLogger(__name__)

load_dotenv()


def _validate_state_size(state: dict[str, Any] | BaseModel, max_size_mb: float = 1.0) -> None:
    """Validate that state JSON size doesn't exceed limit.

    Args:
        state: State dictionary to validate
        max_size_mb: Maximum size in MB (default: 1.0)

    Raises:
        ValueError: If state size exceeds limit
    """

    state_json = state.model_dump_json() if isinstance(state, BaseModel) else json.dumps(state)
    size_bytes = len(state_json.encode("utf-8"))
    max_bytes = int(max_size_mb * 1024 * 1024)

    if size_bytes > max_bytes:
        size_mb = size_bytes / (1024 * 1024)
        raise ValueError(
            f"Workflow state size ({size_mb:.2f}MB) exceeds maximum allowed size "
            f"({max_size_mb}MB). Consider reducing state size or using external storage."
        )


class PolosClient:
    """Client for interacting with the Polos orchestrator API."""

    def __init__(
        self,
        api_url: str | None = None,
        api_key: str | None = None,
        project_id: str | None = None,
        deployment_id: str | None = None,
    ):
        """Initialize Polos client.

        Args:
            api_url: Orchestrator API URL (default: from POLOS_API_URL env var or
                http://localhost:8080)
            api_key: API key for authentication (default: from POLOS_API_KEY env var)
            project_id: Project ID for multi-tenancy (default: from POLOS_PROJECT_ID env var)
            deployment_id: Deployment ID for workflow invocations (default: from
                POLOS_DEPLOYMENT_ID env var, None uses latest deployment)
        """
        self.api_url = api_url or os.getenv("POLOS_API_URL", "http://localhost:8080")
        self.api_key = api_key or os.getenv("POLOS_API_KEY")
        self.project_id = project_id or os.getenv("POLOS_PROJECT_ID")
        self.deployment_id = deployment_id or os.getenv("POLOS_DEPLOYMENT_ID")

        # Validate required fields (with local mode support)
        local_mode_requested = os.getenv("POLOS_LOCAL_MODE", "False").lower() == "true"
        is_localhost = is_localhost_url(self.api_url)
        local_mode = local_mode_requested and is_localhost

        if local_mode_requested and not is_localhost:
            logger.warning(
                f"POLOS_LOCAL_MODE=True ignored because api_url ({self.api_url}) "
                "is not localhost. Falling back to normal authentication."
            )

        if not local_mode and not self.api_key:
            raise ValueError(
                "api_key is required. Set it via PolosClient(api_key='...') "
                "or POLOS_API_KEY environment variable. Or set "
                "POLOS_LOCAL_MODE=True for local development "
                "(only works with localhost URLs)."
            )

        if not self.project_id:
            raise ValueError(
                "project_id is required. Set it via PolosClient(project_id='...') "
                "or POLOS_PROJECT_ID environment variable."
            )

    def _get_headers(self) -> dict[str, str]:
        """Get headers for API requests, including project_id and API key.

        The API key is required for all orchestrator API calls, unless POLOS_LOCAL_MODE=True.
        Local mode is only enabled when api_url is localhost.
        """
        headers = {"Content-Type": "application/json"}

        # Check for local mode (only enabled for localhost URLs)
        local_mode_requested = os.getenv("POLOS_LOCAL_MODE", "False").lower() == "true"
        is_localhost = is_localhost_url(self.api_url)
        local_mode = local_mode_requested and is_localhost

        # API key is required for all orchestrator API calls unless in local mode
        if not local_mode:
            if not self.api_key:
                raise ValueError(
                    "api_key is required. Set it via PolosClient(api_key='...') "
                    "or POLOS_API_KEY environment variable. Or set "
                    "POLOS_LOCAL_MODE=True for local development "
                    "(only works with localhost URLs)."
                )
            headers["Authorization"] = f"Bearer {self.api_key}"

        # Add project_id header (required for multi-tenancy)
        if not self.project_id:
            raise ValueError(
                "project_id is required. Set it via PolosClient(project_id='...') "
                "or POLOS_PROJECT_ID environment variable."
            )
        headers["X-Project-ID"] = self.project_id

        return headers

    async def _get_http_client(self, timeout: httpx.Timeout | None = None) -> httpx.AsyncClient:
        """Get an HTTP client, reusing the worker's client if available.

        Args:
            timeout: Optional timeout for the client (only used if creating new client)

        Returns:
            An httpx.AsyncClient instance (either from worker or newly created)

        Note:
            If using worker's client, it's not closed after use (worker manages its lifecycle).
            If creating a new client, it should be used with `async with` context manager.
        """
        worker_client = get_worker_client()
        if worker_client is not None:
            return worker_client
        else:
            if timeout is not None:
                return httpx.AsyncClient(timeout=timeout)
            else:
                return httpx.AsyncClient()

    async def invoke(
        self,
        workflow_id: str,
        payload: Any = None,
        queue_name: str | None = None,
        queue_concurrency_limit: int | None = None,
        concurrency_key: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        initial_state: dict[str, Any] | None = None,
        run_timeout_seconds: int | None = None,
    ) -> "ExecutionHandle":
        """Invoke a workflow and return an execution handle.

        Args:
            workflow_id: The workflow identifier
            payload: The workflow payload
            queue_name: Optional queue name (if not provided, defaults to workflow_id)
            queue_concurrency_limit: Optional concurrency limit for queue creation
            concurrency_key: Optional concurrency key for per-tenant queuing
            session_id: Optional session ID
            user_id: Optional user ID
            initial_state: Optional initial state dictionary (must be JSON-serializable, max 1MB)
            run_timeout_seconds: Optional timeout in seconds

        Returns:
            ExecutionHandle for the submitted workflow
        """
        return await self._submit_workflow(
            workflow_id=workflow_id,
            deployment_id=self.deployment_id,  # Use client's deployment_id (None uses latest)
            payload=payload,
            queue_name=queue_name,
            queue_concurrency_limit=queue_concurrency_limit,
            concurrency_key=concurrency_key,
            session_id=session_id,
            user_id=user_id,
            initial_state=initial_state,
            run_timeout_seconds=run_timeout_seconds,
        )

    async def batch_invoke(
        self,
        workflows: list[BatchWorkflowInput],
        session_id: str | None = None,
        user_id: str | None = None,
    ) -> list["ExecutionHandle"]:
        """Invoke multiple different workflows in a single batch and return handles immediately.

        Args:
            workflows: List of BatchWorkflowInput objects with 'id' (workflow_id string)
                and 'payload' (dict or Pydantic model)
            session_id: Optional session ID
            user_id: Optional user ID

        Returns:
            List of ExecutionHandle objects for the submitted workflows
        """
        from ..core.workflow import get_workflow
        from ..utils.serializer import serialize

        if not workflows:
            return []

        # Build workflow requests for batch submission
        workflow_requests = []
        for workflow_input in workflows:
            workflow_id = workflow_input.id
            payload = serialize(workflow_input.payload)

            workflow_obj = get_workflow(workflow_id)
            if not workflow_obj:
                raise ValueError(f"Workflow '{workflow_id}' not found")

            workflow_req = {
                "workflow_id": workflow_id,
                "payload": payload,
                "initial_state": serialize(workflow_input.initial_state),
                "run_timeout_seconds": workflow_input.run_timeout_seconds,
            }

            # Per-workflow properties (queue_name, concurrency_key, etc.)
            if workflow_obj.queue_name is not None:
                workflow_req["queue_name"] = workflow_obj.queue_name

            if workflow_obj.queue_concurrency_limit is not None:
                workflow_req["queue_concurrency_limit"] = workflow_obj.queue_concurrency_limit

            workflow_requests.append(workflow_req)

        # Submit all workflows in a single batch using the batch endpoint
        handles = await self._submit_workflows(
            workflows=workflow_requests,
            deployment_id=self.deployment_id,  # Use client's deployment_id (None uses latest)
            parent_execution_id=None,
            root_workflow_id=None,
            root_execution_id=None,
            step_key=None,  # Not invoked from a step, so no step_key
            session_id=session_id,
            user_id=user_id,
            wait_for_subworkflow=False,  # Fire-and-forget
        )

        return handles

    async def resume(
        self,
        suspend_workflow_id: str,
        suspend_execution_id: str,
        suspend_step_key: str,
        data: Any,
    ) -> None:
        """Resume a suspended execution by publishing a resume event.

        Args:
            suspend_workflow_id: The root workflow ID of the suspended execution
            suspend_execution_id: The root execution ID of the suspended execution
            suspend_step_key: The step key that was used in suspend()
            data: Data to pass in the resume event (can be dict or Pydantic BaseModel)
        """
        from ..features.events import EventData, batch_publish
        from ..utils.serializer import serialize

        # Serialize data
        serialized_data = serialize(data)

        topic = f"workflow/{suspend_workflow_id}/{suspend_execution_id}"

        # Publish resume event
        await batch_publish(
            topic=topic,
            events=[EventData(data=serialized_data, event_type=f"resume_{suspend_step_key}")],
            client=self,
        )

    async def get_execution(self, execution_id: str) -> dict[str, Any]:
        """Get execution details from the orchestrator.

        Args:
            execution_id: The execution ID to look up

        Returns:
            Dictionary with execution details including:
            - id, workflow_id, status, payload, result, error
            - created_at, started_at, completed_at
            - deployment_id, parent_execution_id, root_execution_id
            - retry_count, step_key etc.
        """
        headers = self._get_headers()

        # Try to reuse worker's HTTP client if available
        worker_client = get_worker_client()
        if worker_client is not None:
            response = await worker_client.get(
                f"{self.api_url}/api/v1/executions/{execution_id}",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()
        else:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.api_url}/api/v1/executions/{execution_id}",
                    headers=headers,
                )
                response.raise_for_status()
                return response.json()

    async def cancel_execution(self, execution_id: str) -> bool:
        """Cancel an execution by its ID.

        Args:
            execution_id: The execution ID to cancel

        Returns:
            True if cancellation was successful, False otherwise
        """
        headers = self._get_headers()

        # Try to reuse worker's HTTP client if available
        worker_client = get_worker_client()
        if worker_client is not None:
            client = worker_client
            use_context_manager = False
        else:
            client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))
            use_context_manager = True

        try:
            response = await client.post(
                f"{self.api_url}/api/v1/executions/{execution_id}/cancel",
                headers=headers,
            )

            if response.status_code == 404:
                # Execution not found
                return False

            response.raise_for_status()
            return True
        except httpx.HTTPStatusError as e:
            logger.error("Failed to cancel execution %s: %s", execution_id, e)
            return False
        except Exception as e:
            logger.error("Error cancelling execution %s: %s", execution_id, e)
            return False
        finally:
            if use_context_manager:
                await client.aclose()

    async def _submit_workflow(
        self,
        workflow_id: str,
        payload: Any,
        deployment_id: str | None = None,
        parent_execution_id: str | None = None,
        root_workflow_id: str | None = None,
        root_execution_id: str | None = None,
        step_key: str | None = None,
        queue_name: str | None = None,
        queue_concurrency_limit: int | None = None,
        concurrency_key: str | None = None,
        wait_for_subworkflow: bool = False,
        batch_id: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        otel_traceparent: str | None = None,
        initial_state: dict[str, Any] | None = None,
        run_timeout_seconds: int | None = None,
    ) -> "ExecutionHandle":
        """Submit a workflow and return an execution handle.

        Internal method used by invoke() and step.invoke_and_wait().
        """
        headers = self._get_headers()

        # Validate initial_state size if provided
        if initial_state is not None:
            _validate_state_size(initial_state)

        # Inherit session_id and user_id from parent if not provided
        if not session_id or not user_id:
            from ..core.workflow import _execution_context

            exec_context = _execution_context.get()
            if exec_context:
                if not session_id:
                    session_id = exec_context.get("session_id")
                if not user_id:
                    user_id = exec_context.get("user_id")

        # Try to reuse worker's HTTP client if available
        worker_client = get_worker_client()
        if worker_client is not None:
            client = worker_client
            use_context_manager = False
        else:
            client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))
            use_context_manager = True

        try:
            # Submit workflow
            request_json = {
                "payload": payload,
            }
            if step_key:
                request_json["step_key"] = step_key
            # Fall back to client's deployment_id (from env) if not explicitly provided
            effective_deployment_id = deployment_id or self.deployment_id
            if effective_deployment_id:
                request_json["deployment_id"] = effective_deployment_id
            if parent_execution_id:
                request_json["parent_execution_id"] = parent_execution_id
            if root_execution_id:
                request_json["root_execution_id"] = root_execution_id
            if queue_name:
                request_json["queue_name"] = queue_name
            if queue_concurrency_limit is not None:
                request_json["queue_concurrency_limit"] = queue_concurrency_limit
            if concurrency_key:
                request_json["concurrency_key"] = concurrency_key
            request_json["wait_for_subworkflow"] = wait_for_subworkflow
            if batch_id:
                request_json["batch_id"] = batch_id
            if session_id:
                request_json["session_id"] = session_id
            if user_id:
                request_json["user_id"] = user_id
            if otel_traceparent:
                request_json["otel_traceparent"] = otel_traceparent
            if initial_state is not None:
                request_json["initial_state"] = initial_state
            if run_timeout_seconds is not None:
                request_json["run_timeout_seconds"] = run_timeout_seconds

            response = await client.post(
                f"{self.api_url}/api/v1/workflows/{workflow_id}/run",
                json=request_json,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            execution_id_value = data["execution_id"]
            created_at = data.get("created_at")

            # Return handle immediately (fire and forget)
            # Note: If called from within a workflow, the orchestrator has already
            # set the parent to waiting
            # invoke_and_wait() will raise WaitException to pause the parent if needed
            return ExecutionHandle(
                id=execution_id_value,
                workflow_id=workflow_id,
                created_at=created_at,
                parent_execution_id=parent_execution_id,
                root_workflow_id=root_workflow_id,
                root_execution_id=root_execution_id,
                session_id=session_id,
                user_id=user_id,
                step_key=step_key,
            )
        finally:
            if use_context_manager:
                await client.aclose()

    async def _submit_workflows(
        self,
        workflows: list[dict[str, Any]],
        deployment_id: str | None = None,
        parent_execution_id: str | None = None,
        root_workflow_id: str | None = None,
        root_execution_id: str | None = None,
        step_key: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        wait_for_subworkflow: bool = False,
        otel_traceparent: str | None = None,
    ) -> list["ExecutionHandle"]:
        """Submit multiple workflows in a batch and return execution handles.

        Internal method used by batch_invoke() and step.batch_invoke().
        """
        headers = self._get_headers()

        # Inherit session_id and user_id from parent if not provided
        if not session_id or not user_id:
            from ..core.workflow import _execution_context

            exec_context = _execution_context.get()
            if exec_context:
                if not session_id:
                    session_id = exec_context.get("session_id")
                if not user_id:
                    user_id = exec_context.get("user_id")

        # Try to reuse worker's HTTP client if available
        worker_client = get_worker_client()
        if worker_client is not None:
            client = worker_client
            use_context_manager = False
        else:
            client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))
            use_context_manager = True

        try:
            # Prepare batch request
            request_json = {
                "workflows": workflows,
            }

            # Common batch-level properties (shared by all workflows)
            if step_key:
                request_json["step_key"] = step_key
            # Fall back to client's deployment_id (from env) if not explicitly provided
            effective_deployment_id = deployment_id or self.deployment_id
            if effective_deployment_id:
                request_json["deployment_id"] = effective_deployment_id
            if parent_execution_id:
                request_json["parent_execution_id"] = parent_execution_id
            if root_execution_id:
                request_json["root_execution_id"] = root_execution_id
            if session_id:
                request_json["session_id"] = session_id
            if user_id:
                request_json["user_id"] = user_id
            request_json["wait_for_subworkflow"] = wait_for_subworkflow
            if otel_traceparent:
                request_json["otel_traceparent"] = otel_traceparent

            response = await client.post(
                f"{self.api_url}/api/v1/workflows/batch_run",
                json=request_json,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

            # Build ExecutionHandle objects from response
            # The API returns executions in the same order as the request
            handles = []
            executions = data.get("executions", [])
            for i, execution_response in enumerate(executions):
                execution_id = execution_response["execution_id"]
                created_at = execution_response.get("created_at")

                # Get workflow_id from the corresponding workflow request (API doesn't return it)
                # Executions are returned in the same order as the request
                workflow_id = workflows[i]["workflow_id"] if i < len(workflows) else None

                handles.append(
                    ExecutionHandle(
                        id=execution_id,
                        workflow_id=workflow_id,
                        created_at=created_at,
                        parent_execution_id=parent_execution_id,
                        root_workflow_id=root_workflow_id,
                        root_execution_id=root_execution_id,
                        session_id=session_id,
                        user_id=user_id,
                        step_key=step_key,
                    )
                )

            return handles
        finally:
            if use_context_manager:
                await client.aclose()


class ExecutionHandle(BaseModel):
    """Handle for a workflow execution that allows monitoring and management."""

    # Primary field name is 'id'
    id: str
    workflow_id: str | None = None
    created_at: str | None = None
    parent_execution_id: str | None = None
    root_workflow_id: str | None = None
    root_execution_id: str | None = None
    session_id: str | None = None
    user_id: str | None = None
    step_key: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert the execution handle to a dictionary."""
        return self.model_dump(mode="json")

    async def get(self, client: PolosClient) -> dict[str, Any]:
        """Get the current status of the execution."""
        headers = client._get_headers()

        # Try to reuse worker's HTTP client if available
        worker_client = get_worker_client()
        if worker_client is not None:
            response = await worker_client.get(
                f"{client.api_url}/api/v1/executions/{self.id}",
                headers=headers,
            )
            response.raise_for_status()
        else:
            async with httpx.AsyncClient() as http_client:
                response = await http_client.get(
                    f"{client.api_url}/api/v1/executions/{self.id}",
                    headers=headers,
                )
                response.raise_for_status()

        execution = response.json()
        self._cached_status = execution
        result = await self._prepare_result(
            execution.get("result"), execution.get("output_schema_name")
        )

        return {
            "status": execution.get("status"),
            "result": result,
            "error": execution.get("error"),
            "created_at": execution.get("created_at"),
            "completed_at": execution.get("completed_at"),
            "parent_execution_id": execution.get("parent_execution_id"),
            "root_workflow_id": execution.get("root_workflow_id"),
            "root_execution_id": execution.get("root_execution_id"),
            "output_schema_name": execution.get("output_schema_name"),
            "step_key": execution.get("step_key"),
        }

    async def cancel(self, client: PolosClient) -> bool:
        """Cancel the execution if it's still queued or running.

        Returns:
            True if cancellation was successful, False otherwise
        """
        return await client.cancel_execution(self.id)

    # Pydantic will generate __repr__ automatically, but we can customize it if needed
    def __repr__(self) -> str:
        # Use model_dump to get the dictionary representation.
        fields = self.model_dump(exclude_none=True, mode="json")
        field_str = ", ".join(f"{k}={v!r}" for k, v in fields.items())
        return f"ExecutionHandle({field_str})"

    async def _prepare_result(self, result: Any, output_schema_name: str | None = None) -> Any:
        # Reconstruct Pydantic model if output_schema_name is present
        prepared_result = result

        from ..core.workflow import _WORKFLOW_REGISTRY

        workflow = _WORKFLOW_REGISTRY.get(self.workflow_id)

        if output_schema_name and result and isinstance(result, dict):
            # First, check if the workflow has an output_schema stored (set during execution)
            if workflow and hasattr(workflow, "output_schema") and workflow.output_schema:
                # Use the stored output schema class from the workflow
                try:
                    prepared_result = workflow.output_schema.model_validate(result)
                except (ValueError, TypeError) as e:
                    logger.warning(
                        f"Failed to reconstruct Pydantic model using workflow.output_schema: {e}. "
                        f"Falling back to dynamic import."
                    )

            # Fallback to dynamic import if workflow.output_schema is not available
            try:
                # Dynamically import the Pydantic class
                module_path, class_name = output_schema_name.rsplit(".", 1)
                module = __import__(module_path, fromlist=[class_name])
                model_class = getattr(module, class_name)

                # Validate that it's a Pydantic BaseModel
                if issubclass(model_class, BaseModel):
                    prepared_result = model_class.model_validate(result)
            except (ImportError, AttributeError, ValueError, TypeError) as e:
                # If reconstruction fails, log warning but return dict
                # This allows backward compatibility if the class is not available
                logger.warning(
                    f"Failed to reconstruct Pydantic model '{output_schema_name}': {e}. "
                    f"Returning dict instead."
                )

        # Handle structured output for agents
        from ..agents.agent import Agent

        if workflow and isinstance(workflow, Agent) and isinstance(prepared_result, AgentResult):
            # Convert result to structured output schema
            if workflow.result_output_schema and prepared_result.result is not None:
                prepared_result.result = workflow.result_output_schema.model_validate(
                    prepared_result.result
                )

            # Convert tool results to structured output schema
            for tool_result in prepared_result.tool_results:
                if tool_result.result_schema and tool_result.result is not None:
                    try:
                        # Dynamically import the Pydantic class
                        module_path, class_name = tool_result.result_schema.rsplit(".", 1)
                        module = __import__(module_path, fromlist=[class_name])
                        model_class = getattr(module, class_name)

                        # Validate that it's a Pydantic BaseModel
                        if issubclass(model_class, BaseModel):
                            tool_result.result = model_class.model_validate(tool_result.result)
                    except (ImportError, AttributeError, ValueError, TypeError) as e:
                        # If reconstruction fails, log warning but return dict
                        # This allows backward compatibility if the class is not available
                        logger.warning(
                            f"Failed to reconstruct Pydantic model "
                            f"'{tool_result.result_schema}': {e}. "
                            f"Returning dict instead."
                        )

        return prepared_result


# Internal functions that get client from context
async def store_step_output(
    execution_id: str,
    step_key: str,
    outputs: Any | None = None,
    error: Any | None = None,
    success: bool | None = True,
    source_execution_id: str | None = None,
    output_schema_name: str | None = None,
) -> None:
    """Store step output for recovery.

    Args:
        execution_id: Execution ID
        step_key: Step key identifier (required, must be unique per execution)
        outputs: Step outputs (optional)
        error: Step error (optional)
        success: Whether step succeeded (optional)
        source_execution_id: Source execution ID (optional)
        output_schema_name: Full module path of Pydantic class for deserialization (optional)
    """
    client = get_client_or_raise()
    headers = client._get_headers()

    # Build request payload, only including fields that are not None
    payload = {
        "step_key": step_key,
    }

    if outputs is not None:
        payload["outputs"] = outputs
    if error is not None:
        payload["error"] = error
    if success is not None:
        payload["success"] = success
    if source_execution_id is not None:
        payload["source_execution_id"] = source_execution_id
    if output_schema_name is not None:
        payload["output_schema_name"] = output_schema_name

    # Try to reuse worker's HTTP client if available
    worker_client = get_worker_client()
    if worker_client is not None:
        response = await worker_client.post(
            f"{client.api_url}/internal/executions/{execution_id}/steps",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
    else:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                f"{client.api_url}/internal/executions/{execution_id}/steps",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()


async def get_step_output(execution_id: str, step_key: str) -> dict[str, Any] | None:
    """Get step output for recovery.

    Args:
        execution_id: Execution ID
        step_key: Step key identifier (required)

    Returns:
        Step output dictionary or None if not found
    """
    client = get_client_or_raise()
    headers = client._get_headers()

    # Try to reuse worker's HTTP client if available
    worker_client = get_worker_client()
    if worker_client is not None:
        response = await worker_client.get(
            f"{client.api_url}/internal/executions/{execution_id}/steps/{step_key}",
            headers=headers,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    else:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"{client.api_url}/internal/executions/{execution_id}/steps/{step_key}",
                headers=headers,
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()


async def get_all_step_outputs(execution_id: str) -> list:
    """Get all step outputs for an execution (for recovery)."""
    client = get_client_or_raise()
    headers = client._get_headers()

    # Try to reuse worker's HTTP client if available
    worker_client = get_worker_client()
    if worker_client is not None:
        response = await worker_client.get(
            f"{client.api_url}/internal/executions/{execution_id}/steps",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("steps", [])
    else:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(
                f"{client.api_url}/internal/executions/{execution_id}/steps",
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("steps", [])


async def update_execution_otel_span_id(execution_id: str, otel_span_id: str | None) -> None:
    """Update execution's otel_span_id (used when workflow is paused via WaitException)."""
    client = get_client_or_raise()
    headers = client._get_headers()

    # Try to reuse worker's HTTP client if available
    worker_client = get_worker_client()
    if worker_client is not None:
        response = await worker_client.put(
            f"{client.api_url}/internal/executions/{execution_id}/otel-span-id",
            headers=headers,
            json={"otel_span_id": otel_span_id},
        )
        response.raise_for_status()
    else:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.put(
                f"{client.api_url}/internal/executions/{execution_id}/otel-span-id",
                headers=headers,
                json={"otel_span_id": otel_span_id},
            )
            response.raise_for_status()
