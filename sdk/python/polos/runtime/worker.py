"""Worker class for executing Polos workflows, agents, and tools."""

import asyncio
import json
import logging
import os
import signal
import traceback
from datetime import datetime
from typing import Any

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel

from ..agents.agent import Agent
from ..core.workflow import _WORKFLOW_REGISTRY, StepExecutionError, Workflow
from ..features.wait import WaitException
from ..tools.tool import Tool
from ..utils.config import is_localhost_url
from ..utils.worker_singleton import set_current_worker
from .client import PolosClient

# FastAPI imports for push mode
try:
    from .worker_server import WorkerServer

    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False
    WorkerServer = None

load_dotenv()
logger = logging.getLogger(__name__)


class Worker:
    """
    Polos worker that executes workflows and agents.

    The worker:
    1. Registers with the orchestrator (creates/replaces deployment)
    2. Registers agent and tool definitions
    3. Registers all workflows/agents in deployment_workflows table
    4. Polls orchestrator for workflows and executes them

    Usage:
        from polos import Worker, Agent, Tool, PolosClient

        client = PolosClient(api_url="http://localhost:8080")

        # Define your workflows
        research_agent = Agent(...)
        analysis_agent = Agent(...)

        # Create worker
        worker = Worker(
            client=client,
            deployment_id=os.getenv("WORKER_DEPLOYMENT_ID"),
            agents=[research_agent, analysis_agent],
            tools=[search_web],
            workflows=[step_condition_workflow],
        )

        # Run worker (blocks until shutdown)
        await worker.run()
    """

    def __init__(
        self,
        client: PolosClient,
        deployment_id: str | None = None,
        agents: list[Agent] | None = None,
        tools: list[Tool] | None = None,
        workflows: list[Workflow] | None = None,
        max_concurrent_workflows: int | None = None,
        mode: str = "push",  # "push" or "pull"
        worker_server_url: str | None = None,  # Required if mode="push"
    ):
        """
        Initialize worker.

        Args:
            client: PolosClient instance (required)
            deployment_id: Required deployment ID (unique identifier for the deployment)
            agents: List of Agent instances to register
            tools: List of Tool instances to register
            workflows: List of Workflow instances to register
            max_concurrent_workflows: Maximum number of workflows to execute in parallel.
                If not provided, reads from POLOS_MAX_CONCURRENT_WORKFLOWS env var
                (default: 100)
            mode: Worker mode - "push" (default) or "pull".
                Push mode uses FastAPI server to receive work.
            worker_server_url: Full URL for worker server endpoint
                (e.g., "https://worker.example.com").
                If not provided and mode="push", will be auto-generated from
                POLOS_WORKER_SERVER_URL env var or default to "http://localhost:8000"

        Raises:
            ValueError: If deployment_id is not provided,
                or if mode="push" but FastAPI unavailable
        """
        self.polos_client = client
        self.deployment_id = deployment_id or os.getenv("POLOS_DEPLOYMENT_ID")
        if not self.deployment_id:
            raise ValueError(
                "deployment_id is required for Worker initialization. "
                "Set it via parameter or POLOS_DEPLOYMENT_ID env var."
            )

        # Use client's configuration
        self.project_id = client.project_id
        self.api_url = client.api_url

        # Check if local_mode can be enabled (only allowed for localhost addresses)
        local_mode_requested = os.getenv("POLOS_LOCAL_MODE", "False").lower() == "true"
        is_localhost = is_localhost_url(self.api_url)
        self.local_mode = local_mode_requested and is_localhost

        if local_mode_requested and not is_localhost:
            logger.warning(
                "POLOS_LOCAL_MODE=True ignored because api_url (%s) is not localhost.",
                self.api_url,
            )

        self.api_key = client.api_key
        if not self.local_mode and not self.api_key:
            raise ValueError(
                "api_key is required for Worker initialization. "
                "Set it via PolosClient(api_key='...') or POLOS_API_KEY environment variable. "
                "Or set POLOS_LOCAL_MODE=True for local development "
                "(only works with localhost URLs)."
            )

        # Worker mode configuration
        self.mode = mode.lower()
        if self.mode not in ("push", "pull"):
            raise ValueError(f"mode must be 'push' or 'pull', got '{mode}'")

        if self.mode == "pull":
            raise ValueError("[Worker] Pull mode not supported yet. Use push mode instead.")

        if self.mode == "push":
            if not FASTAPI_AVAILABLE:
                raise ValueError(
                    "FastAPI and uvicorn are required for push mode. "
                    "Install with: pip install fastapi uvicorn"
                )

            # Determine push endpoint URL
            if worker_server_url:
                self.worker_server_url = worker_server_url
            else:
                env_url = os.getenv("POLOS_WORKER_SERVER_URL")
                if env_url:
                    self.worker_server_url = env_url
                else:
                    self.worker_server_url = "http://localhost:8000"

            self.worker_server: WorkerServer | None = None
        else:
            self.worker_server_url = None
            self.worker_server = None

        # Get max_concurrent_workflows from parameter, env var, or default
        if max_concurrent_workflows is not None:
            self.max_concurrent_workflows = max_concurrent_workflows
        else:
            env_value = os.getenv("POLOS_MAX_CONCURRENT_WORKFLOWS")
            if env_value:
                try:
                    self.max_concurrent_workflows = int(env_value)
                except ValueError:
                    logger.warning(
                        "Invalid POLOS_MAX_CONCURRENT_WORKFLOWS value '%s', using default 100",
                        env_value,
                    )
                    self.max_concurrent_workflows = 100
            else:
                self.max_concurrent_workflows = 100

        self.execution_semaphore = asyncio.Semaphore(self.max_concurrent_workflows)
        self.active_executions: set = set()
        # Store tasks for each execution (for manual cancellation)
        self.execution_tasks: dict[str, asyncio.Task] = {}
        self.execution_tasks_lock = asyncio.Lock()

        # Build workflow registry
        self.workflows_registry: dict[str, Workflow] = {}
        self.agents: list[Agent] = [a for a in (agents or []) if isinstance(a, Agent)] or []
        self.tools: list[Tool] = [t for t in (tools or []) if isinstance(t, Tool)] or []
        self.agent_ids: list[str] = []
        self.tool_ids: list[str] = []
        self.workflow_ids: list[str] = []

        # Process workflows list - convert stop conditions to Workflow instances
        processed_workflows: list[Workflow] = []
        for workflow in workflows or []:
            # Regular Workflow instance
            if not isinstance(workflow, Workflow):
                logger.warning("Skipping non-Workflow object in workflows list: %s", workflow)
                continue

            processed_workflows.append(workflow)
            self.workflows_registry[workflow.id] = workflow
            self.workflow_ids.append(workflow.id)

        # Store processed workflows (all are Workflow instances now)
        self.workflows: list[Workflow] = processed_workflows

        # Register all agents and tools in local registry
        for agent in self.agents:
            if isinstance(agent, Agent):
                self.workflows_registry[agent.id] = agent
                self.agent_ids.append(agent.id)

        for tool in self.tools:
            if isinstance(tool, Tool):
                self.workflows_registry[tool.id] = tool
                self.tool_ids.append(tool.id)

        # Worker state
        self.worker_id: str | None = None
        self.running = False
        self.poll_task: asyncio.Task | None = None
        self.heartbeat_task: asyncio.Task | None = None
        self.worker_server_task: asyncio.Task | None = None

        # Reusable HTTP client for polling operations
        self.client: httpx.AsyncClient | None = None

    async def run(self):
        """Run the worker (blocks until shutdown)."""
        logger.info("Starting worker...")
        logger.info("Deployment ID: %s", self.deployment_id)
        logger.info("Orchestrator: %s", self.api_url)

        self.client = httpx.AsyncClient(timeout=httpx.Timeout(35.0, connect=5.0))

        # Register with orchestrator
        await self._register()

        # Register deployment
        await self._register_deployment()

        # Register agents, tools, and workflows
        await self._register_agents()
        await self._register_tools()
        await self._register_workflows()

        # Register/update queues used by workflows, and agents
        await self._register_queues()

        # Mark worker as online after all registrations are complete
        await self._mark_online()

        self.running = True

        # Register this worker instance so client.py can reuse its HTTP client
        # and so features can access the client
        set_current_worker(self)

        # Setup signal handlers
        def signal_handler(sig):
            """Handle shutdown signals."""
            logger.info("Received signal %s, shutting down...", sig)
            # Create shutdown task
            asyncio.create_task(self.shutdown())

        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda s=sig: signal_handler(s))

        # Start tasks based on mode
        if self.mode == "push":
            # Initialize push server
            self._setup_worker_server()

            # Start FastAPI server for push mode
            self.worker_server_task = asyncio.create_task(self.worker_server.run())
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            try:
                await asyncio.gather(
                    self.worker_server_task, self.heartbeat_task, return_exceptions=True
                )
            except Exception as e:
                logger.error("Error in worker tasks: %s", e)
        else:
            # Start polling and heartbeat tasks for pull mode
            self.poll_task = asyncio.create_task(self._poll_loop())
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            try:
                await asyncio.gather(self.poll_task, self.heartbeat_task, return_exceptions=True)
            except Exception as e:
                logger.error("Error in worker tasks: %s", e)

    async def _register(self):
        """Register worker with orchestrator."""
        try:
            headers = self._get_headers()
            registration_data = {
                "deployment_id": self.deployment_id,
                "project_id": self.project_id,
                "mode": self.mode,
                "capabilities": {
                    "runtime": "python",
                    "agent_ids": self.agent_ids,
                    "tool_ids": self.tool_ids,
                    "workflow_ids": self.workflow_ids,
                },
                "max_concurrent_executions": self.max_concurrent_workflows,
            }

            # Add worker_server_url if in push mode
            if self.mode == "push":
                registration_data["push_endpoint_url"] = self.worker_server_url

            response = await self.client.post(
                f"{self.api_url}/api/v1/workers/register",
                json=registration_data,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            self.worker_id = data["worker_id"]

            logger.info("Registered: %s (mode: %s)", self.worker_id, self.mode)
        except Exception as error:
            logger.error("Registration failed: %s", error)
            raise

    async def _mark_online(self):
        """Mark worker as online after completing all registrations."""
        try:
            headers = self._get_headers()
            response = await self.client.post(
                f"{self.api_url}/api/v1/workers/{self.worker_id}/online",
                headers=headers,
            )
            response.raise_for_status()
            logger.info("Marked as online: %s", self.worker_id)
        except Exception as error:
            logger.warning("Failed to mark worker as online: %s", error)
            # Don't raise - allow worker to continue, heartbeat will update status

    async def _re_register(self):
        """Re-register worker, deployment, agents, tools, workflows, and queues."""
        try:
            # Register with orchestrator (gets new worker_id)
            await self._register()

            # Register deployment
            await self._register_deployment()

            # Register agents, tools, and workflows
            await self._register_agents()
            await self._register_tools()
            await self._register_workflows()

            # Register/update queues used by workflows, and agents
            await self._register_queues()

            # Mark worker as online after all registrations are complete
            await self._mark_online()

            # Update push server with new worker_id if in push mode
            if self.mode == "push" and self.worker_server:
                self.worker_server.update_worker_id(self.worker_id)
                logger.debug("Updated push server with new worker_id: %s", self.worker_id)

            logger.info("Re-registration complete: %s", self.worker_id)
        except Exception as error:
            logger.error("Re-registration failed: %s", error)
            # Don't raise - allow heartbeat to continue and retry later

    async def _register_deployment(self):
        """Create or replace deployment in orchestrator."""
        try:
            headers = self._get_headers()
            response = await self.client.post(
                f"{self.api_url}/api/v1/workers/deployments",
                json={
                    "deployment_id": self.deployment_id,
                },
                headers=headers,
            )
            response.raise_for_status()

            logger.info("Deployment registered: %s", self.deployment_id)
        except Exception as error:
            logger.error("Deployment registration failed: %s", error)
            raise

    async def _register_agents(self):
        """Register agent definitions and add to deployment_workflows."""
        for agent in self.agents:
            try:
                # Register agent definition
                headers = self._get_headers()
                # Get tool definitions for agent
                tools_json = None
                if agent.tools:
                    tools_list = []
                    for tool in agent.tools:
                        if isinstance(tool, Tool):
                            tools_list.append(tool.to_llm_tool_definition())
                        elif isinstance(tool, dict):
                            tools_list.append(tool)
                    if tools_list:
                        import json

                        tools_json = json.loads(json.dumps(tools_list))

                # Build metadata with stop condition function names and guardrail info
                metadata = {}
                if agent.provider_base_url:
                    metadata["provider_base_url"] = agent.provider_base_url

                # Add stop condition function names
                if agent.stop_conditions:
                    stop_condition_names = []
                    for sc in agent.stop_conditions:
                        # Get the function name from the configured callable
                        # Check for __stop_condition_name__ attribute first (set by decorator)
                        if hasattr(sc, "__stop_condition_name__"):
                            stop_condition_names.append(sc.__stop_condition_name__)
                        # Fall back to __name__ attribute
                        elif hasattr(sc, "__name__"):
                            stop_condition_names.append(sc.__name__)
                        else:
                            # Last resort: use string representation
                            stop_condition_names.append(str(sc))

                    if stop_condition_names:
                        metadata["stop_conditions"] = stop_condition_names

                # Add guardrail function names and strings
                if agent.guardrails:
                    guardrail_info = []
                    for gr in agent.guardrails:
                        if callable(gr):
                            # Get function name for callable guardrails
                            if hasattr(gr, "__name__") and gr.__name__ != "<lambda>":
                                guardrail_info.append({"type": "function", "name": gr.__name__})
                            else:
                                guardrail_info.append({"type": "function", "name": str(gr)})
                        elif isinstance(gr, str):
                            # Include string guardrails (truncate if too long for readability)
                            truncated = gr[:200] + "..." if len(gr) > 200 else gr
                            guardrail_info.append({"type": "string", "content": truncated})

                    if guardrail_info:
                        metadata["guardrails"] = guardrail_info

                # Set to None if empty to avoid sending empty dict
                if not metadata:
                    metadata = None

                response = await self.client.post(
                    f"{self.api_url}/api/v1/agents/register",
                    json={
                        "id": agent.id,
                        "deployment_id": self.deployment_id,
                        "provider": agent.provider,
                        "model": agent.model,
                        "system_prompt": agent.system_prompt,
                        "tools": tools_json,
                        "temperature": agent.temperature,
                        "max_output_tokens": agent.max_output_tokens,
                        "metadata": metadata,
                    },
                    headers=headers,
                )
                response.raise_for_status()

                # Register in deployment_workflows
                await self._register_deployment_workflow(agent.id, "agent")

                logger.debug("Registered agent: %s", agent.id)
            except Exception as error:
                logger.error("Failed to register agent %s: %s", agent.id, error)
                raise

    async def _register_tools(self):
        """Register tool definitions."""
        for tool in self.tools:
            try:
                tool_type = tool.get_tool_type()
                metadata = tool.get_tool_metadata()

                # Register tool definition
                headers = self._get_headers()
                response = await self.client.post(
                    f"{self.api_url}/api/v1/tools/register",
                    json={
                        "id": tool.id,
                        "deployment_id": self.deployment_id,
                        "tool_type": tool_type,
                        "description": tool._tool_description,
                        "parameters": tool._tool_parameters,
                        "metadata": metadata,
                    },
                    headers=headers,
                )
                response.raise_for_status()

                # Register in deployment_workflows
                await self._register_deployment_workflow(tool.id, "tool")

                logger.debug("Registered tool: %s (type: %s)", tool.id, tool_type)
            except Exception as error:
                logger.error("Failed to register tool %s: %s", tool.id, error)
                raise

    async def _register_workflows(self):
        """Register workflows in deployment_workflows, event triggers, and schedules."""
        # self.workflows now only contains Workflow instances (stop conditions already converted)
        for workflow in self.workflows:
            try:
                # Check if workflow is event-triggered (trigger_on_event is the topic string if set)
                is_event_triggered = (
                    hasattr(workflow, "trigger_on_event") and workflow.trigger_on_event is not None
                )
                event_topic = workflow.trigger_on_event if is_event_triggered else None

                # Check if workflow is schedulable (schedule=True or has cron string/dict)
                is_schedulable = getattr(workflow, "is_schedulable", False)

                # Register in deployment_workflows with boolean flags
                await self._register_deployment_workflow(
                    workflow.id, "workflow", is_event_triggered, is_schedulable
                )

                # Register event trigger if workflow has trigger_on_event
                if is_event_triggered and event_topic:
                    queue_name = workflow.queue_name or workflow.id
                    await self._register_event_trigger(
                        workflow.id,
                        event_topic,
                        getattr(workflow, "batch_size", 1),
                        getattr(workflow, "batch_timeout_seconds", None),
                        queue_name,
                    )

                # Register schedule if workflow has a cron schedule (not just schedule=True)
                schedule_config = getattr(workflow, "schedule", None)
                if schedule_config and schedule_config is not True and schedule_config is not False:
                    # schedule is a cron string or dict - register it
                    await self._register_schedule(workflow)

                logger.debug("Registered workflow: %s", workflow.id)
            except Exception as error:
                logger.error("Failed to register workflow %s: %s", workflow.id, error)
                raise

    async def _register_event_trigger(
        self,
        workflow_id: str,
        event_topic: str,
        batch_size: int,
        batch_timeout_seconds: int | None,
        queue_name: str,
    ):
        """Register an event trigger for a workflow."""
        headers = self._get_headers()
        response = await self.client.post(
            f"{self.api_url}/api/v1/event-triggers/register",
            json={
                "workflow_id": workflow_id,
                "deployment_id": self.deployment_id,
                "event_topic": event_topic,
                "batch_size": batch_size,
                "batch_timeout_seconds": batch_timeout_seconds,
                "queue_name": queue_name,
            },
            headers=headers,
        )
        response.raise_for_status()

    async def _register_queues(self):
        """Register/update queues used by workflows, agents, and tools."""
        # Collect all unique queues from workflows, agents, and tools
        queues: dict[str, int | None] = {}

        # Collect from workflows
        for workflow in self.workflows:
            # Skip scheduled workflows - they get their own queues registered separately
            is_schedulable = getattr(workflow, "is_schedulable", False)
            if is_schedulable:
                continue

            # If queue_name is None, workflow will use workflow.id as queue name at runtime
            queue_name = getattr(workflow, "queue_name", None) or workflow.id

            # Scheduled workflows always have concurrency=1
            if getattr(workflow, "is_schedulable", False):
                queue_limit = 1
            else:
                queue_limit = getattr(workflow, "queue_concurrency_limit", None)

            # If queue already exists, use the more restrictive limit if both are set
            if queue_name in queues:
                if queue_limit is not None and queues[queue_name] is not None:
                    queues[queue_name] = min(queues[queue_name], queue_limit)
                elif queue_limit is not None:
                    queues[queue_name] = queue_limit
            else:
                queues[queue_name] = queue_limit

        # Collect from agents
        for agent in self.agents:
            # If queue_name is None, agent will use agent.id as queue name at runtime
            queue_name = getattr(agent, "queue_name", None) or agent.id
            queue_limit = getattr(agent, "queue_concurrency_limit", None)
            if queue_name in queues:
                if queue_limit is not None and queues[queue_name] is not None:
                    queues[queue_name] = min(queues[queue_name], queue_limit)
                elif queue_limit is not None:
                    queues[queue_name] = queue_limit
            else:
                queues[queue_name] = queue_limit

        # Collect from tools
        for tool in self.tools:
            # If queue_name is None, agent will use agent.id as queue name at runtime
            queue_name = getattr(tool, "queue_name", None) or tool.id
            queue_limit = getattr(tool, "queue_concurrency_limit", None)
            if queue_name in queues:
                if queue_limit is not None and queues[queue_name] is not None:
                    queues[queue_name] = min(queues[queue_name], queue_limit)
                elif queue_limit is not None:
                    queues[queue_name] = queue_limit
            else:
                queues[queue_name] = queue_limit

        # Batch register/update all queues
        if queues:
            try:
                headers = self._get_headers()
                # Convert dict to list of queue info dicts
                queues_list = [
                    {"name": name, "concurrency_limit": limit} for name, limit in queues.items()
                ]
                response = await self.client.post(
                    f"{self.api_url}/api/v1/workers/queues",
                    json={"deployment_id": self.deployment_id, "queues": queues_list},
                    headers=headers,
                )
                response.raise_for_status()
                logger.info(
                    "Registered/updated %d queue(s) for deployment %s",
                    len(queues),
                    self.deployment_id,
                )
            except Exception as error:
                logger.error("Failed to register queues: %s", error)
                # Don't raise - queue registration failure shouldn't stop worker startup

    async def _register_deployment_workflow(
        self,
        workflow_id: str,
        workflow_type: str,
        trigger_on_event: bool = False,
        scheduled: bool = False,
    ):
        """Register a workflow/agent in deployment_workflows table."""
        headers = self._get_headers()
        request_body = {
            "workflow_id": workflow_id,
            "workflow_type": workflow_type,
            "trigger_on_event": trigger_on_event,
            "scheduled": scheduled,
        }
        response = await self.client.post(
            f"{self.api_url}/api/v1/workers/deployments/{self.deployment_id}/workflows",
            json=request_body,
            headers=headers,
        )
        response.raise_for_status()

    async def _register_schedule(self, workflow: Workflow):
        """Register a schedule for a workflow."""
        schedule_config = workflow.schedule

        # Parse schedule configuration
        if isinstance(schedule_config, str):
            # Simple cron string - use UTC timezone and "global" key
            cron = schedule_config
            timezone = "UTC"
            key = "global"
        elif isinstance(schedule_config, dict):
            # Dict with cron and optional timezone and key
            cron = schedule_config.get("cron")
            timezone = schedule_config.get("timezone", "UTC")
            key = schedule_config.get("key", "global")  # Default to "global" if not provided
            if not cron:
                raise ValueError("Schedule dict must contain 'cron' key")
        else:
            raise ValueError(f"Invalid schedule type: {type(schedule_config)}")

        headers = self._get_headers()
        request_body = {
            "workflow_id": workflow.id,
            "cron": cron,
            "timezone": timezone,
            "key": key,
        }

        response = await self.client.post(
            f"{self.api_url}/api/v1/schedules",
            json=request_body,
            headers=headers,
        )
        response.raise_for_status()
        logger.info(
            "Registered schedule for workflow: %s (cron: %s, timezone: %s, key: %s)",
            workflow.id,
            cron,
            timezone,
            key,
        )

    async def _poll_loop(self):
        """Continuously poll for workflows (batch)."""
        while self.running:
            try:
                if not self.worker_id:
                    await asyncio.sleep(1)
                    continue

                # Calculate available slots
                available_slots = self.max_concurrent_workflows - len(self.active_executions)
                if available_slots <= 0:
                    # No available slots, wait a bit before polling again
                    await asyncio.sleep(0.1)
                    continue

                headers = self._get_headers()
                # Poll for multiple workflows (up to available slots)
                response = await self.client.get(
                    f"{self.api_url}/api/v1/workers/{self.worker_id}/poll",
                    params={"max_workflows": available_slots},
                    headers=headers,
                )

                if response.status_code != 200:
                    await asyncio.sleep(1)
                    continue

                workflows_data = response.json()

                if workflows_data:
                    logger.debug(
                        "Received %d workflow(s) (requested %d, active: %d)",
                        len(workflows_data),
                        available_slots,
                        len(self.active_executions),
                    )
                    # Execute all workflows in background
                    for workflow_data in workflows_data:

                        async def execute_with_error_handling(exec_data):
                            import contextlib

                            with contextlib.suppress(Exception):
                                # Exceptions are already handled in _execute_workflow
                                # This just prevents "Task exception was never retrieved" warning
                                await self._execute_workflow_with_semaphore(exec_data)

                        asyncio.create_task(execute_with_error_handling(workflow_data))
                # If no workflows, will continue polling (long poll timeout handled by httpx)

            except asyncio.CancelledError:
                break
            except httpx.TimeoutException:
                # Expected on long poll timeout
                pass
            except Exception as error:
                logger.error("Poll error: %s", error)
                await asyncio.sleep(1)  # Wait before retrying on error

    async def _execute_workflow_with_semaphore(self, workflow_data: dict[str, Any]):
        """Execute a workflow with semaphore control for concurrency limiting."""
        execution_id = workflow_data["execution_id"]

        # Acquire semaphore (blocks if at max concurrency)
        async with self.execution_semaphore:
            self.active_executions.add(execution_id)
            try:
                await self._execute_workflow(workflow_data)
            finally:
                self.active_executions.discard(execution_id)

    async def _execute_workflow(self, workflow_data: dict[str, Any]):
        """Execute a workflow from the registry."""
        execution_id = workflow_data["execution_id"]
        run_timeout_seconds = workflow_data.get("run_timeout_seconds")

        try:
            workflow_id = workflow_data["workflow_id"]
            # First check worker's local registry (explicitly registered workflows)
            workflow = self.workflows_registry.get(workflow_id)

            # If not found, check global registry (for system workflows and other workflows)
            if not workflow:
                workflow = _WORKFLOW_REGISTRY.get(workflow_id)

            if not workflow:
                raise ValueError(
                    f"Workflow {workflow_id} not found in registry or global workflow registry"
                )

            # Build context
            context = {
                "execution_id": execution_id,
                "deployment_id": workflow_data.get("deployment_id"),
                "parent_execution_id": workflow_data.get("parent_execution_id"),
                "root_execution_id": workflow_data.get("root_execution_id"),
                "retry_count": workflow_data.get("retry_count", 0),
                "session_id": workflow_data.get("session_id"),
                "user_id": workflow_data.get("user_id"),
                "otel_traceparent": workflow_data.get("otel_traceparent"),
                "otel_span_id": workflow_data.get("otel_span_id"),
                "initial_state": workflow_data.get("initial_state"),
                "run_timeout_seconds": run_timeout_seconds,
            }

            payload = workflow_data["payload"]
            created_at_str = workflow_data.get("created_at")

            # Parse created_at if provided
            created_at = None
            if created_at_str:
                import contextlib

                with contextlib.suppress(ValueError, AttributeError):
                    created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))

            context["created_at"] = created_at

            # Create task for workflow execution and store it for cancellation
            workflow_task = asyncio.create_task(workflow._execute(context, payload))
            async with self.execution_tasks_lock:
                self.execution_tasks[execution_id] = workflow_task

            # Check for timeout
            timeout_task = None
            if run_timeout_seconds:

                async def check_timeout():
                    """Background task to check for timeout."""
                    try:
                        await asyncio.sleep(run_timeout_seconds)
                        # Timeout reached - check if execution is still running
                        async with self.execution_tasks_lock:
                            task = self.execution_tasks.get(execution_id)
                            if task and not task.done():
                                # Timeout reached, cancel the execution
                                task.cancel()
                                logger.warning(
                                    "Execution %s timed out after %d seconds",
                                    execution_id,
                                    run_timeout_seconds,
                                )
                    except asyncio.CancelledError:
                        # Execution was cancelled manually, ignore
                        pass

                timeout_task = asyncio.create_task(check_timeout())

            try:
                # Execute workflow
                result, final_state = await workflow_task
            except asyncio.CancelledError:
                # Execution was cancelled (either manually or due to timeout)
                logger.info("Execution %s was cancelled", execution_id)
                await self._handle_cancellation(execution_id, workflow_id, context)
                raise
            finally:
                # Clean up
                if timeout_task:
                    timeout_task.cancel()
                    import contextlib

                    with contextlib.suppress(asyncio.CancelledError):
                        await timeout_task

                async with self.execution_tasks_lock:
                    self.execution_tasks.pop(execution_id, None)

            # Prepare result for reporting:
            # - If it's a Pydantic model, convert to dict via model_dump(mode="json") and
            #   store schema name
            # - Otherwise, ensure it's JSON-serializable via json.dumps()
            prepared_result = result
            output_schema_name = None
            try:
                if isinstance(result, BaseModel):
                    prepared_result = result.model_dump(mode="json")
                    # Store full module path for Pydantic model reconstruction
                    output_schema_name = (
                        f"{result.__class__.__module__}.{result.__class__.__name__}"
                    )
                else:
                    # Validate JSON serializability; json.dumps will raise on failure
                    json.dumps(result)
            except (TypeError, ValueError) as e:
                # Serialization failed; propagate so it is handled by the outer except block
                raise TypeError(
                    f"Workflow result is not JSON serializable: "
                    f"{type(result).__name__}. Error: {str(e)}"
                ) from e

            # Report success with already validated/serialized-safe result and schema name
            await self._report_success(
                workflow_data["execution_id"], prepared_result, output_schema_name, final_state
            )

        except WaitException as e:
            # WaitException is expected when a workflow waits for a sub-workflow
            # The orchestrator will resume the execution when the sub-workflow completes
            # Do not report this as a failure - it's the normal wait mechanism
            logger.debug("Workflow paused for waiting: %s", e)
            return

        except Exception as error:
            # Capture the full stack trace
            error_message = str(error)
            stack_trace = traceback.format_exc()
            logger.error("Execution error: %s\nStack trace:\n%s", error_message, stack_trace)

            # Extract final_state from execution context if workflow has state_schema
            workflow_id = workflow_data.get("workflow_id")
            workflow = self.workflows_registry.get(workflow_id) or _WORKFLOW_REGISTRY.get(
                workflow_id
            )

            # Check if error is StepExecutionError - if so, mark as non-retryable
            # Tools are not retryable by default. We feed the error back to the LLM to handle.
            retryable = (
                workflow
                and not isinstance(error, StepExecutionError)
                and workflow.workflow_type != "tool"
            )
            await self._report_failure(
                workflow_data["execution_id"], error_message, stack_trace, retryable=retryable
            )
            raise

    def _setup_worker_server(self):
        """Setup FastAPI server for push mode."""
        if not FASTAPI_AVAILABLE:
            raise RuntimeError("FastAPI not available")

        # Create callback function that executes workflow
        async def on_work_received(workflow_data: dict[str, Any]):
            """Callback to handle received work."""
            await self._execute_workflow_with_semaphore(workflow_data)

        # Create callback function that handles cancel requests
        async def on_cancel_requested(execution_id: str) -> bool:
            """Callback to handle cancel requests.

            Returns:
                True if execution was found and cancelled, False if not found or already completed
            """
            return await self._handle_cancel_request(execution_id)

        # Initialize worker server
        self.worker_server = WorkerServer(
            worker_id=self.worker_id,
            max_concurrent_workflows=self.max_concurrent_workflows,
            on_work_received=on_work_received,
            on_cancel_requested=on_cancel_requested,
            local_mode=self.local_mode,
        )

        logger.info("Worker server initialized")

    async def _report_success(
        self,
        execution_id: str,
        result: Any,
        output_schema_name: str | None = None,
        final_state: dict[str, Any] | None = None,
    ):
        """Report successful workflow execution with retries and exponential backoff."""
        max_retries = 5
        base_delay = 1.0  # Start with 1 second

        for attempt in range(max_retries):
            try:
                headers = self._get_headers()
                payload = {
                    "result": result,
                    "worker_id": self.worker_id,  # Include worker_id for validation
                }
                if output_schema_name:
                    payload["output_schema_name"] = output_schema_name
                if final_state is not None:
                    payload["final_state"] = final_state
                response = await self.client.post(
                    f"{self.api_url}/internal/executions/{execution_id}/complete",
                    json=payload,
                    headers=headers,
                )

                # Handle 409 Conflict (execution reassigned)
                if response.status_code == 409:
                    logger.debug(
                        "Execution %s was reassigned [old worker %s], ignoring completion",
                        execution_id,
                        self.worker_id,
                    )
                    return  # Don't retry on 409

                response.raise_for_status()
                # Success - return immediately
                return
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 409:
                    # 409 Conflict - execution reassigned, don't retry
                    logger.debug("Execution %s was reassigned, ignoring completion", execution_id)
                    return
                if attempt < max_retries - 1:
                    # Calculate exponential backoff: 1s, 2s, 4s, 8s, 16s
                    delay = base_delay * (2**attempt)
                    logger.warning(
                        "Failed to report success (attempt %d/%d): %s. Retrying in %ds...",
                        attempt + 1,
                        max_retries,
                        e,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    # Final attempt failed - report as failure with error message
                    error_msg = f"Failed to report success after {max_retries} attempts: {e}"
                    logger.error("%s", error_msg)
                    # Don't call _report_failure here to avoid infinite loop
            except Exception as error:
                if attempt < max_retries - 1:
                    # Calculate exponential backoff: 1s, 2s, 4s, 8s, 16s
                    delay = base_delay * (2**attempt)
                    logger.warning(
                        "Failed to report success (attempt %d/%d): %s. Retrying in %ds...",
                        attempt + 1,
                        max_retries,
                        error,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    # Final attempt failed - report as failure with error message
                    error_msg = f"Failed to report success after {max_retries} attempts: {error}"
                    logger.error("%s", error_msg)
                    await self._report_failure(execution_id, error_msg, retryable=True)

    async def _report_failure(
        self,
        execution_id: str,
        error_message: str,
        stack_trace: str | None = None,
        retryable: bool = True,
        final_state: dict[str, Any] | None = None,
    ):
        """Report failed workflow execution with retries and exponential backoff.

        Args:
            execution_id: Execution ID to report failure for
            error_message: Error message
            stack_trace: Optional stack trace
            retryable: Whether the execution should be retried (default: True)
        """
        max_retries = 5
        base_delay = 1.0  # Start with 1 second

        for attempt in range(max_retries):
            try:
                headers = self._get_headers()
                payload = {
                    "error": error_message,
                    "worker_id": self.worker_id,  # Include worker_id for validation
                }
                if stack_trace:
                    payload["stack"] = stack_trace
                if not retryable:
                    payload["retryable"] = False
                if final_state is not None:
                    payload["final_state"] = final_state
                response = await self.client.post(
                    f"{self.api_url}/internal/executions/{execution_id}/fail",
                    json=payload,
                    headers=headers,
                )

                # Handle 409 Conflict (execution reassigned)
                if response.status_code == 409:
                    logger.debug("Execution %s was reassigned, ignoring failure", execution_id)
                    return  # Don't retry on 409

                response.raise_for_status()
                # Success - return immediately
                return
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 409:
                    # 409 Conflict - execution reassigned, don't retry
                    logger.debug("Execution %s was reassigned, ignoring failure", execution_id)
                    return
                if attempt < max_retries - 1:
                    # Calculate exponential backoff: 1s, 2s, 4s, 8s, 16s
                    delay = base_delay * (2**attempt)
                    logger.warning(
                        "Failed to report failure (attempt %d/%d): %s. Retrying in %ds...",
                        attempt + 1,
                        max_retries,
                        e,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    # Final attempt failed
                    logger.error("Failed to report failure after %d attempts: %s", max_retries, e)
            except Exception as error:
                if attempt < max_retries - 1:
                    # Calculate exponential backoff: 1s, 2s, 4s, 8s, 16s
                    delay = base_delay * (2**attempt)
                    logger.warning(
                        "Failed to report failure (attempt %d/%d): %s. Retrying in %ds...",
                        attempt + 1,
                        max_retries,
                        error,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    # Final attempt failed
                    logger.error(
                        "Failed to report failure after %d attempts: %s", max_retries, error
                    )

    async def _handle_cancel_request(self, execution_id: str) -> bool:
        """Handle cancellation request from orchestrator.

        Returns:
            True if execution was found and cancelled, False if not found or already completed
        """
        logger.info("Handling cancellation request for execution %s", execution_id)
        async with self.execution_tasks_lock:
            task = self.execution_tasks.get(execution_id)
            if task and not task.done():
                logger.debug("Cancelling task %s", task)
                # Cancel the task
                task.cancel()
                logger.info("Cancellation requested for execution %s", execution_id)
                return True
            else:
                logger.debug("Execution %s not found or already completed", execution_id)
                return False

    async def _handle_cancellation(
        self, execution_id: str, workflow_id: str, context: dict[str, Any]
    ):
        """Handle execution cancellation - send confirmation and emit event."""
        try:
            logger.info("Sending cancellation confirmation for execution %s", execution_id)
            # Send cancel confirmation to orchestrator
            await self._send_cancel_confirmation(execution_id)

            # Emit cancellation event
            await self._emit_cancellation_event(execution_id, workflow_id, context)
        except Exception as e:
            logger.error("Error handling cancellation for %s: %s", execution_id, e)

    async def _send_cancel_confirmation(self, execution_id: str):
        """Send cancellation confirmation to orchestrator."""
        max_retries = 5
        base_delay = 1.0

        for attempt in range(max_retries):
            try:
                headers = self._get_headers()
                payload = {
                    "worker_id": self.worker_id,
                }
                response = await self.client.post(
                    f"{self.api_url}/internal/executions/{execution_id}/confirm-cancellation",
                    json=payload,
                    headers=headers,
                )

                # Handle 409 Conflict (execution reassigned)
                if response.status_code == 409:
                    logger.debug(
                        "Execution %s was reassigned, ignoring cancellation confirmation",
                        execution_id,
                    )
                    return

                response.raise_for_status()
                logger.info("Sent cancellation confirmation for execution %s", execution_id)
                return
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 409:
                    logger.debug(
                        "Execution %s was reassigned, ignoring cancellation confirmation",
                        execution_id,
                    )
                    return
                if attempt < max_retries - 1:
                    delay = base_delay * (2**attempt)
                    logger.warning(
                        "Failed to send cancellation confirmation "
                        "(attempt %d/%d): %s. Retrying in %ds...",
                        attempt + 1,
                        max_retries,
                        e,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "Failed to send cancellation confirmation after %d attempts: %s",
                        max_retries,
                        e,
                    )
            except Exception as error:
                if attempt < max_retries - 1:
                    delay = base_delay * (2**attempt)
                    logger.warning(
                        "Failed to send cancellation confirmation "
                        "(attempt %d/%d): %s. Retrying in %ds...",
                        attempt + 1,
                        max_retries,
                        error,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "Failed to send cancellation confirmation after %d attempts: %s",
                        max_retries,
                        error,
                    )

    async def _emit_cancellation_event(
        self, execution_id: str, workflow_id: str, context: dict[str, Any]
    ):
        """Emit cancellation event for the workflow."""
        try:
            from ..features.events import publish

            # Topic format: workflow:{execution_id}
            topic = f"workflow:{context.get('root_execution_id') or execution_id}"

            # Event type: {workflow_id}_cancel
            event_type = f"{context.get('workflow_type', 'workflow')}_cancel"

            # Event data
            event_data = {
                "_metadata": {
                    "execution_id": execution_id,
                    "workflow_id": workflow_id,
                }
            }

            # Publish event
            await publish(
                self.polos_client,
                topic=topic,
                event_type=event_type,
                data=event_data,
                execution_id=execution_id,
                root_execution_id=context.get("root_execution_id"),
            )

            logger.debug("Emitted cancellation event for execution %s", execution_id)
        except Exception as e:
            logger.error("Failed to emit cancellation event for %s: %s", execution_id, e)

    async def _heartbeat_loop(self):
        """Send periodic heartbeats."""
        while self.running:
            try:
                await asyncio.sleep(30)

                if not self.worker_id:
                    continue

                headers = self._get_headers()
                response = await self.client.post(
                    f"{self.api_url}/api/v1/workers/{self.worker_id}/heartbeat",
                    headers=headers,
                )
                response.raise_for_status()

                # Check if re-registration is required
                data = response.json()
                if data.get("re_register", False):
                    logger.info("Orchestrator requested re-registration, re-registering...")
                    await self._re_register()
            except asyncio.CancelledError:
                break
            except Exception as error:
                logger.warning("Heartbeat failed: %s", error)

    async def shutdown(self):
        """Graceful shutdown."""
        if not self.running:
            return

        logger.info("Shutting down gracefully...")
        self.running = False

        # Shutdown worker server first (if in push mode)
        if self.mode == "push" and self.worker_server:
            try:
                await self.worker_server.shutdown()
            except Exception as e:
                logger.error("Error shutting down worker server: %s", e)

        # Cancel tasks
        if self.mode == "push":
            if self.worker_server_task:
                self.worker_server_task.cancel()
        else:
            if self.poll_task:
                self.poll_task.cancel()

        if self.heartbeat_task:
            self.heartbeat_task.cancel()

        # Wait for cancellation
        if self.mode == "push":
            try:
                if self.worker_server_task:
                    await self.worker_server_task
            except asyncio.CancelledError:
                pass
        else:
            try:
                if self.poll_task:
                    await self.poll_task
            except asyncio.CancelledError:
                pass

        try:
            if self.heartbeat_task:
                await self.heartbeat_task
        except asyncio.CancelledError:
            pass

        # Close HTTP client
        if hasattr(self, "client") and self.client:
            try:
                await self.client.aclose()
            except Exception as e:
                logger.error("Error closing HTTP client: %s", e)

        # Unregister this worker instance
        set_current_worker(None)

        logger.info("Shutdown complete")

    def _get_headers(self) -> dict[str, str]:
        """Get HTTP headers for API requests, including API key and project_id."""
        return self.polos_client._get_headers()
