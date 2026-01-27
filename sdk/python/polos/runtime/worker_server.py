"""FastAPI server for push-based workers."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import uvicorn
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class WorkerServer:
    """FastAPI server that receives pushed work from the orchestrator."""

    def __init__(
        self,
        worker_id: str,
        max_concurrent_workflows: int,
        on_work_received: Callable[[dict[str, Any]], Awaitable[None]],
        on_cancel_requested: Callable[[str], Awaitable[bool]] | None = None,
        port: int = 8000,
        local_mode: bool = False,
    ):
        """
        Initialize worker server.

        Args:
            max_concurrent_workflows: Maximum number of concurrent workflows
            on_work_received: Async callback function to handle received work
            on_cancel_requested: Optional async callback function to handle cancel
                requests (execution_id)
            port: Port to run the server on
        """
        self.worker_id = worker_id
        self.max_concurrent_workflows = max_concurrent_workflows
        self.on_work_received = on_work_received
        self.on_cancel_requested = on_cancel_requested
        self.port = port
        self.current_execution_count = 0
        self.local_mode = local_mode
        self.app: FastAPI | None = None
        self.server: uvicorn.Server | None = None
        self._setup_app()

    def update_worker_id(self, new_worker_id: str):
        """Update the worker_id (used when re-registering)."""
        self.worker_id = new_worker_id

    def _setup_app(self):
        """Setup FastAPI application with endpoints."""
        self.app = FastAPI(title="Polos Worker Server Endpoint")

        @self.app.post("/execute")
        async def execute(request: Request):
            """Receive pushed work from orchestrator."""
            try:
                # Check if worker is at capacity
                if self.current_execution_count >= self.max_concurrent_workflows:
                    return JSONResponse(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        content={"error": "Worker at capacity"},
                    )

                # Parse request body
                body = await request.json()
                worker_id = body.get("worker_id")
                if worker_id != self.worker_id:
                    return JSONResponse(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        content={"error": "Worker ID mismatch"},
                    )

                # Extract execution data
                execution_id = body.get("execution_id")
                workflow_id = body.get("workflow_id")
                payload = body.get("payload", {})
                root_execution_id = body.get("root_execution_id")
                step_key = body.get("step_key")
                session_id = body.get("session_id")
                user_id = body.get("user_id")
                retry_count = body.get("retry_count", 0)

                # Log execution request with detailed context
                logger.info(
                    "POST /execute - execution_id=%s, worker_id=%s, workflow_id=%s, "
                    "root_execution_id=%s, step_key=%s, session_id=%s, user_id=%s, "
                    "retry_count=%d",
                    execution_id,
                    self.worker_id,
                    workflow_id,
                    root_execution_id,
                    step_key,
                    session_id,
                    user_id,
                    retry_count,
                )

                # Build workflow_data dict (same format as poll mode)
                workflow_data = {
                    "execution_id": execution_id,
                    "workflow_id": workflow_id,
                    "deployment_id": body.get("deployment_id"),
                    "payload": payload,
                    "parent_execution_id": body.get("parent_execution_id"),
                    "root_execution_id": root_execution_id,
                    "step_key": step_key,
                    "retry_count": retry_count,
                    "created_at": body.get("created_at"),
                    "session_id": session_id,
                    "user_id": user_id,
                    "otel_traceparent": body.get("otel_traceparent"),
                    "otel_span_id": body.get("otel_span_id"),
                    "initial_state": body.get("initial_state"),
                    "run_timeout_seconds": body.get("run_timeout_seconds"),
                }

                # Increment execution count
                self.current_execution_count += 1

                # Execute in background (don't await)
                async def execute_with_cleanup(exec_data):
                    try:
                        await self.on_work_received(exec_data)
                    except Exception:
                        # Exceptions are already handled in on_work_received callback
                        # This just prevents "Task exception was never retrieved" warning
                        pass
                    finally:
                        # Decrement execution count when done
                        self.current_execution_count = max(0, self.current_execution_count - 1)

                asyncio.create_task(execute_with_cleanup(workflow_data))

                # Return 200 OK immediately (work accepted)
                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "accepted", "execution_id": execution_id},
                )

            except Exception as e:
                # On error, return 503 Service Unavailable
                return JSONResponse(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content={"error": str(e)}
                )

        @self.app.post("/cancel/{execution_id}")
        async def cancel_execution(execution_id: str, request: Request):
            """Handle cancellation request from orchestrator."""
            try:
                # Get worker_id from header (X-Worker-ID) or request body
                worker_id = request.headers.get("X-Worker-ID")
                if not worker_id:
                    raise ValueError("Missing Worker ID in the request headers")

                if worker_id and str(worker_id) != self.worker_id:
                    return JSONResponse(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        content={"error": "Worker ID mismatch"},
                    )

                # Trigger cancellation and await result to check if execution was found
                if self.on_cancel_requested:
                    execution_found = await self.on_cancel_requested(execution_id)
                    if execution_found:
                        return JSONResponse(
                            status_code=status.HTTP_200_OK,
                            content={
                                "status": "cancellation_requested",
                                "execution_id": execution_id,
                            },
                        )
                    else:
                        # Execution not found or already completed - return 404
                        return JSONResponse(
                            status_code=status.HTTP_404_NOT_FOUND,
                            content={
                                "error": "Execution not found or already completed",
                                "execution_id": execution_id,
                            },
                        )
                else:
                    # No cancel handler - return 503
                    return JSONResponse(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        content={"error": "Cancel handler not configured"},
                    )
            except Exception as e:
                return JSONResponse(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"error": str(e)}
                )

        @self.app.get("/health")
        async def health_check():
            """Health check endpoint."""
            return {
                "status": "healthy",
                "mode": "push",
                "current_executions": self.current_execution_count,
                "max_concurrent_workflows": self.max_concurrent_workflows,
            }

    async def run(self):
        """Run the FastAPI server."""
        if not self.app:
            raise RuntimeError("FastAPI app not initialized")

        host = "127.0.0.1" if self.local_mode else "0.0.0.0"

        # Get uvicorn's default logging config and ensure root logger captures application logs
        # This allows module loggers (using __name__) to appear alongside FastAPI logs
        import copy

        from uvicorn.config import LOGGING_CONFIG

        logging_config = copy.deepcopy(LOGGING_CONFIG)
        # Configure root logger to capture all application logs
        if "" not in logging_config["loggers"]:
            logging_config["loggers"][""] = {}
        logging_config["loggers"][""].update(
            {
                "handlers": ["default"],
                "level": "INFO",
                "propagate": False,
            }
        )
        # Disable httpx HTTP request logs (set to WARNING to suppress INFO level logs)
        logging_config["loggers"]["httpx"] = {
            "handlers": ["default"],
            "level": "WARNING",
            "propagate": False,
        }

        config = uvicorn.Config(
            self.app,
            host=host,
            port=self.port,
            log_level="info",
            log_config=logging_config,
        )
        self.server = uvicorn.Server(config)
        await self.server.serve()

    async def shutdown(self):
        """Shutdown the server gracefully."""
        if self.server:
            self.server.should_exit = True
