"""Unified Polos class that combines PolosClient and Worker into a single object."""

import asyncio
import logging
import os
from typing import Any

from .agents.agent import Agent
from .channels.channel import Channel
from .core.workflow import get_all_workflows
from .runtime.client import ExecutionHandle, PolosClient
from .runtime.worker import Worker
from .tools.tool import Tool
from .types.types import BatchWorkflowInput

logger = logging.getLogger(__name__)


def _configure_file_logging(log_file: str) -> None:
    """Redirect all SDK logs to a file instead of stdout/stderr."""
    handler = logging.FileHandler(log_file, mode="a")
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s"))
    # Configure root logger so all SDK loggers (polos.*, httpx, etc.) use the file
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


class Polos:
    """Unified Polos client + worker.

    Combines PolosClient (submit/stream work) and Worker (receive/execute work)
    into a single object. One process, one import.

    For production deployments where you need to scale workers independently
    from clients, use the separate PolosClient and Worker classes directly.

    Usage::

        from polos import Polos, Agent, tool

        @tool(description="Get weather")
        async def get_weather(ctx, input):
            return {"temp": 72}

        weather_agent = Agent(
            id="weather", provider="openai", model="gpt-4o",
            system_prompt="You are a weather assistant.",
            tools=[get_weather],
        )

        # Script mode: context manager
        async with Polos() as polos:
            result = await weather_agent.run(polos, "What's the weather in Paris?")
            print(result)

        # Script mode: start/stop
        polos = Polos()
        await polos.start()
        result = await weather_agent.run(polos, "What's the weather?")
        await polos.stop()

        # Server mode: blocks until SIGINT/SIGTERM
        polos = Polos()
        await polos.serve()
    """

    def __init__(
        self,
        project_id: str | None = None,
        api_url: str | None = None,
        api_key: str | None = None,
        deployment_id: str | None = None,
        port: int = 8000,
        max_concurrent_workflows: int | None = None,
        channels: list[Channel] | None = None,
        log_file: str | None = None,
    ):
        self._project_id = project_id or os.getenv("POLOS_PROJECT_ID")
        self._api_url = api_url or os.getenv("POLOS_API_URL", "http://localhost:8080")
        self._api_key = api_key or os.getenv("POLOS_API_KEY")
        self._deployment_id = deployment_id or os.getenv("POLOS_DEPLOYMENT_ID", "default")
        self._port = port or os.getenv("POLOS_WORKER_PORT", 8000)
        self._channels = channels
        self._log_file = log_file

        # Redirect SDK logs to file if requested
        if log_file:
            _configure_file_logging(log_file)

        # Create client
        self._client = PolosClient(
            project_id=self._project_id,
            api_url=self._api_url,
            api_key=self._api_key,
            deployment_id=self._deployment_id,
        )

        # Discover agents, tools, and workflows from the global WORKFLOW_REGISTRY.
        # They auto-register when defined (Agent(), Tool(), @workflow), so no need
        # to pass them explicitly.
        all_workflows = get_all_workflows()
        agents = [w for w in all_workflows.values() if isinstance(w, Agent)]
        tools = [w for w in all_workflows.values() if isinstance(w, Tool)]
        workflows = [w for w in all_workflows.values() if not isinstance(w, (Agent, Tool))]

        # Create worker
        self._worker = Worker(
            client=self._client,
            deployment_id=self._deployment_id,
            agents=agents,
            tools=tools,
            workflows=workflows,
            max_concurrent_workflows=max_concurrent_workflows,
            mode="push",
            worker_server_url=f"http://localhost:{self._port}",
            log_file=log_file,
            channels=self._channels,
        )

        # Track state
        self._started = False
        self._server_task: asyncio.Task | None = None

    # ── Lifecycle ──

    async def start(self):
        """Start the worker in background (non-blocking).

        Registers with orchestrator, starts FastAPI server, begins heartbeat.
        Returns once registration is complete so the caller can immediately
        invoke workflows.
        """
        if self._started:
            return

        # Phase 1: register (blocking — must complete before we return)
        await self._worker._register_all()
        self._started = True

        # Phase 2: start server in background (non-blocking)
        self._server_task = asyncio.create_task(self._run_server_safe())

        logger.info(
            "Polos started (orchestrator=%s, worker=:%d, deployment=%s)",
            self._api_url,
            self._port,
            self._deployment_id,
        )

    async def _run_server_safe(self):
        """Internal: run the worker server, logging errors instead of crashing."""
        try:
            await self._worker._run_server()
        except Exception as err:
            logger.error("Worker server error: %s", err)

    async def serve(self):
        """Start the worker and block until shutdown signal (SIGINT/SIGTERM).

        This is the deployment mode — equivalent to Worker.run().
        Use for servers, Kubernetes, Docker, etc.
        """
        await self.start()
        if self._server_task:
            await self._server_task

    async def stop(self):
        """Gracefully stop the worker and clean up."""
        if not self._started:
            return

        await self._worker.shutdown()

        if self._server_task:
            # Wait for server to finish shutting down
            await self._server_task
            self._server_task = None

        self._started = False
        logger.info("Polos stopped")

    # ── Context manager ──

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.stop()

    # ── Client interface ──
    # Delegate to internal PolosClient so agent.run(polos, ...) works.
    # agent.run() calls client._submit_workflow() and other methods internally.

    @property
    def project_id(self):
        return self._client.project_id

    @property
    def api_url(self):
        return self._client.api_url

    @property
    def api_key(self):
        return self._client.api_key

    @property
    def deployment_id(self):
        return self._client.deployment_id

    def _get_headers(self) -> dict[str, str]:
        return self._client._get_headers()

    async def _submit_workflow(self, *args, **kwargs) -> ExecutionHandle:
        return await self._client._submit_workflow(*args, **kwargs)

    async def _submit_workflows(self, *args, **kwargs) -> list[ExecutionHandle]:
        return await self._client._submit_workflows(*args, **kwargs)

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
    ) -> ExecutionHandle:
        """Invoke a workflow and return an execution handle."""
        return await self._client.invoke(
            workflow_id=workflow_id,
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
    ) -> list[ExecutionHandle]:
        """Invoke multiple workflows in batch."""
        return await self._client.batch_invoke(
            workflows=workflows,
            session_id=session_id,
            user_id=user_id,
        )

    async def resume(
        self,
        suspend_workflow_id: str,
        suspend_execution_id: str,
        suspend_step_key: str,
        data: Any,
    ) -> None:
        """Resume a suspended execution."""
        return await self._client.resume(
            suspend_workflow_id=suspend_workflow_id,
            suspend_execution_id=suspend_execution_id,
            suspend_step_key=suspend_step_key,
            data=data,
        )

    async def get_execution(self, execution_id: str) -> dict[str, Any]:
        """Get execution details."""
        return await self._client.get_execution(execution_id)

    async def cancel_execution(self, execution_id: str) -> bool:
        """Cancel an execution."""
        return await self._client.cancel_execution(execution_id)
