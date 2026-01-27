"""Agent decorator and Agent class for LLM-powered workflows."""

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from ..core.context import AgentContext
from ..core.workflow import _WORKFLOW_REGISTRY, Workflow, _execution_context
from ..runtime.client import ExecutionHandle
from ..runtime.queue import Queue
from ..types.types import AgentConfig, AgentResult
from ..utils.output_schema import convert_output_schema
from ..utils.serializer import deserialize_agent_result

logger = logging.getLogger(__name__)


class AgentRunConfig:
    """Configuration for batch agent execution."""

    def __init__(
        self,
        agent: "Agent",
        input: str | list[dict[str, Any]],
        session_id: str | None = None,
        conversation_id: str | None = None,
        user_id: str | None = None,
        streaming: bool = False,
        initial_state: BaseModel | dict[str, Any] | None = None,
        run_timeout_seconds: int | None = None,
        **kwargs,
    ):
        self.agent = agent
        self.input = input
        self.session_id = session_id
        self.conversation_id = conversation_id
        self.user_id = user_id
        self.streaming = streaming
        self.initial_state = initial_state
        self.run_timeout_seconds = run_timeout_seconds
        self.kwargs = kwargs


class StreamResult:
    """Result object for streaming agent responses.

    This class wraps ExecutionHandle and adds event polling capabilities.
    agent_run_id is the same as execution_id.
    """

    def __init__(self, execution_handle: ExecutionHandle):
        """Initialize StreamResult from an ExecutionHandle.

        Args:
            execution_handle: The ExecutionHandle from agent.invoke() when streaming is True
        """
        # Store reference to the ExecutionHandle
        self.handle = execution_handle

        # Ensure root_execution_id is set (use execution_id if root_execution_id is None)
        if not execution_handle.root_execution_id:
            execution_handle.root_execution_id = execution_handle.id

        # Expose commonly used properties for convenience
        self.agent_run_id = execution_handle.id  # execution_id is the same as agent_run_id
        self.topic = (
            f"workflow:{execution_handle.root_execution_id}"  # Topic derived from root_execution_id
        )

    # Delegate ExecutionHandle properties/methods
    @property
    def id(self) -> str:
        """Get execution ID (same as agent_run_id)."""
        return self.handle.id

    @property
    def workflow_id(self) -> str | None:
        """Get workflow ID."""
        return self.handle.workflow_id

    @property
    def created_at(self) -> str | None:
        """Get creation timestamp."""
        return self.handle.created_at

    @property
    def parent_execution_id(self) -> str | None:
        """Get parent execution ID."""
        return self.handle.parent_execution_id

    @property
    def root_execution_id(self) -> str | None:
        """Get root execution ID."""
        return self.handle.root_execution_id

    @property
    def session_id(self) -> str | None:
        """Get session ID."""
        return self.handle.session_id

    @property
    def user_id(self) -> str | None:
        """Get user ID."""
        return self.handle.user_id

    @property
    def step_key(self) -> str | None:
        """Get step key."""
        return self.handle.step_key

    async def get(self) -> dict[str, Any]:
        """Get the current status of the execution."""
        return await self.handle.get()

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return self.handle.to_dict()

    def __repr__(self) -> str:
        """String representation."""
        return f"StreamResult(agent_run_id={self.agent_run_id}, topic={self.topic})"

    @property
    def text_chunks(self) -> "TextChunkIterator":
        """Iterate text chunks only.

        Example:
            async for chunk in result.text_chunks:
                print(chunk, end="")
        """
        return TextChunkIterator(self)

    @property
    def events(self) -> "FullEventIterator":
        """Iterate all events (text, tool calls, etc.).

        Example:
            async for event in result.events:
                if event.event_type == "text_delta":
                    print(event.data.get("content", ""))
        """
        return FullEventIterator(self)

    async def text(self) -> str:
        """Get final accumulated text.

        Example:
            final_text = await result.text()
            print(final_text)
        """
        accumulated = ""
        async for chunk in self.text_chunks:
            if chunk:
                accumulated += chunk
        return accumulated

    async def result(self) -> AgentResult:
        """Get complete result with usage, tool calls, etc.

        Example:
            final_result = await result.result()
            print(final_result.result)
            print(final_result.usage)
        """
        result_data = None
        from ..features.events import stream_workflow

        async for event in stream_workflow(workflow_run_id=self.agent_run_id, last_sequence_id=0):
            if (
                event.event_type == "agent_finish"
                and event.data.get("_metadata", {}).get("execution_id") == self.agent_run_id
            ):
                result_data = event.data.get("result")
                break

        if result_data:
            agent_result = AgentResult(
                agent_run_id=result_data.get("agent_run_id"),
                result=result_data.get("result"),
                result_schema=result_data.get("result_schema"),
                tool_results=result_data.get("tool_results"),
                total_steps=result_data.get("total_steps", 0),
                usage=result_data.get("usage"),
            )
            return await deserialize_agent_result(agent_result)

        raise Exception("No result found for agent run id: " + self.agent_run_id)


class AgentStreamHandle:
    """Handle for streaming agent responses."""

    def __init__(self, agent_run_id: str, root_execution_id: str, created_at: str | None = None):
        self.agent_run_id = agent_run_id
        self.topic = f"workflow:{root_execution_id or agent_run_id}"
        self.last_valid_event_id = None  # Track last valid event (skip invalid ones)
        self.created_at = created_at  # Timestamp when agent_run was created

    async def __aiter__(self):
        """Async iterator that yields chunks from events via SSE.

        Uses events.stream_workflow() to stream events from the orchestrator.
        Filters out invalid events (from failed/retried attempts).
        """
        from ..features.events import stream_workflow

        # Convert created_at string to datetime if provided
        last_timestamp = None
        if self.created_at:
            import contextlib

            with contextlib.suppress(ValueError, AttributeError):
                last_timestamp = datetime.fromisoformat(self.created_at.replace("Z", "+00:00"))

        # Use events.stream_workflow() with agent_run_id
        async for event in stream_workflow(
            workflow_run_id=self.agent_run_id, last_timestamp=last_timestamp
        ):
            event_type = event.event_type
            self.last_valid_event_id = event.id
            yield event

            # Handle workflow finish event
            if (
                event_type == "agent_finish"
                and event.data.get("_metadata", {}).get("execution_id") == self.agent_run_id
            ):
                break

    def __repr__(self) -> str:
        return (
            f"AgentStreamHandle(agent_run_id={self.agent_run_id}, "
            f"root_execution_id={self.root_execution_id or self.agent_run_id})"
        )


class TextChunkIterator:
    """Iterator for text chunks only."""

    def __init__(self, result: "StreamResult"):
        self.result = result
        self._handle_iter = None

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._handle_iter is None:
            handle = AgentStreamHandle(
                self.result.id, self.result.root_execution_id, self.result.created_at
            )
            self._handle_iter = handle.__aiter__()

        # Filter for text chunks only
        while True:
            try:
                event = await self._handle_iter.__anext__()
                if event.event_type == "text_delta":
                    return event.data.get("content", "")
            except StopAsyncIteration:
                raise


class FullEventIterator:
    """Iterator for all events."""

    def __init__(self, result: "StreamResult"):
        self.result = result
        self._handle_iter = None

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._handle_iter is None:
            handle = AgentStreamHandle(
                self.result.id, self.result.root_execution_id, self.result.created_at
            )
            self._handle_iter = handle.__aiter__()

        return await self._handle_iter.__anext__()


class Agent(Workflow):
    """
    Agent class that inherits from Workflow - agents are durable, retriable
    workflows with LLM capabilities.

    Agents can be triggered, composed with other tasks, and benefit from all task features:
    - Automatic checkpointing and retry
    - Queue management and concurrency control
    - Parent-child execution tracking
    - Observability and tracing

    Usage:
        # Define agent
        weather_agent = Agent(
            id="weather-agent",
            provider="openai",
            model="gpt-4o",
            system_prompt="You are a helpful weather assistant",
            tools=[get_weather]
        )

        # Start the agent
        result = await weather_agent.invoke({
            "input": "What's the weather in NYC?",
            "streaming": False
        })
        print(result["text"])

        # Or Start the agent with streaming
        stream_handle = await weather_agent.stream({
            "input": "What's the weather in NYC?",
            "streaming": True
        })
        async for chunk in stream_handle.events:
            print(chunk.data.get("content", ""), end="", flush=True)

        # Or use convenience method to start the agent and wait for it to complete
        result = await weather_agent.run("What's the weather in NYC?")

        # Stream response (from within a task)
        stream_result = await weather_agent.stream("What's the weather?")
        async for event in stream_result.events:
            if event.event_type == "text_delta":
                print(event.data.get("content", ""), end="", flush=True)
    """

    def __init__(
        self,
        id: str,  # Required: task ID
        provider: str,
        model: str,
        system_prompt: str | None = None,
        tools: list[Any] | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
        provider_base_url: str | None = None,
        provider_llm_api: str | None = None,
        queue: str | Queue | dict[str, Any] | None = None,
        stop_conditions: list[Any] | None = None,
        output_schema: type[Any] | None = None,  # Pydantic model class for structured output
        on_start: Callable | list[Callable] | None = None,
        on_end: Callable | list[Callable] | None = None,
        on_agent_step_start: Callable | list[Callable] | None = None,
        on_agent_step_end: Callable | list[Callable] | None = None,
        on_tool_start: Callable | list[Callable] | None = None,
        on_tool_end: Callable | list[Callable] | None = None,
        guardrails: Callable | str | list[Callable | str] | None = None,
        guardrail_max_retries: int = 2,
        conversation_history: int = 10,  # Number of messages to keep
    ):
        # Parse queue configuration (same as task decorator)
        queue_name: str | None = None
        queue_concurrency_limit: int | None = None

        if queue is not None:
            if isinstance(queue, str):
                queue_name = queue
            elif isinstance(queue, Queue):
                queue_name = queue.name
                queue_concurrency_limit = queue.concurrency_limit
            elif isinstance(queue, dict):
                queue_name = queue.get("name", id)
                queue_concurrency_limit = queue.get("concurrency_limit")

        # Initialize as Workflow with agent execution function
        super().__init__(
            id=id,
            func=self._agent_execute,
            workflow_type="agent",
            queue_name=queue_name,
            queue_concurrency_limit=queue_concurrency_limit,
            on_start=on_start,
            on_end=on_end,
            output_schema=AgentResult,
        )

        # Agent configuration
        self.provider = provider

        # Store provider_base_url and provider_llm_api for AgentConfig
        self.provider_base_url = provider_base_url
        self.provider_llm_api = provider_llm_api

        self.model = model
        self.system_prompt = system_prompt
        self.tools = tools or []
        self.temperature = temperature
        self.max_output_tokens = max_output_tokens
        self.result_output_schema = output_schema  # Pydantic model class
        self.stop_conditions: list[Callable] = []

        # Agent-specific lifecycle hooks
        self.on_agent_step_start = self._normalize_hooks(on_agent_step_start)
        self.on_agent_step_end = self._normalize_hooks(on_agent_step_end)
        self.on_tool_start = self._normalize_hooks(on_tool_start)
        self.on_tool_end = self._normalize_hooks(on_tool_end)

        # Guardrails
        self.guardrails = self._normalize_guardrails(guardrails)
        self.guardrail_max_retries = guardrail_max_retries

        # Conversation history
        self.conversation_history = conversation_history

        # Convert Pydantic model to JSON schema if provided
        self._output_json_schema, self._output_schema_name = convert_output_schema(
            output_schema, context_id=self.id
        )

        # Normalize and validate stop conditions:
        # Only accept callables (configured callables from @stop_condition decorator)
        for sc in stop_conditions or []:
            if not callable(sc):
                raise TypeError(
                    f"Invalid stop_condition {sc!r} for agent '{id}'. "
                    f"Each stop condition must be a callable (use @stop_condition decorator)."
                )
            self.stop_conditions.append(sc)

        # Register locally (for in-process calls)
        _WORKFLOW_REGISTRY[id] = self

    def _normalize_guardrails(
        self, guardrails: Callable | str | list[Callable | str] | None
    ) -> list[Callable | str]:
        """Normalize guardrails to a list of callables or strings.

        Accepts:
        - None: Returns empty list
        - Callable: Single guardrail callable
        - str: Single string guardrail
        - List[Union[Callable, str]]: List of guardrail callables or strings
        """

        if guardrails is None:
            return []
        if callable(guardrails) or isinstance(guardrails, str):
            return [guardrails]
        if isinstance(guardrails, list):
            result = []
            for gr in guardrails:
                if callable(gr) or isinstance(gr, str):
                    result.append(gr)
                else:
                    raise TypeError(
                        f"Invalid guardrail type: {type(gr)}. Expected a callable "
                        f"(function decorated with @guardrail) or a string."
                    )
            return result
        raise TypeError(
            f"Invalid guardrails type: {type(guardrails)}. Expected callable, "
            f"string, or List[Union[callable, str]]."
        )

    async def _agent_execute(self, ctx: AgentContext, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Internal execution function - runs the agent and collects streaming results.

        This is called by the Workflow execution framework.
        """
        # Extract input
        if not isinstance(payload, dict):
            raise TypeError(
                f"Payload must be a dict, got {type(payload).__name__} for agent {self.id}"
            )

        input_data = payload.get("input")
        streaming = payload.get("streaming", False)  # Whether to stream or return final result
        provider_kwargs = payload.get(
            "provider_kwargs", {}
        )  # Additional kwargs to pass to provider
        conversation_id = payload.get("conversation_id")  # Conversation ID for conversation history

        # Build agent config
        agent_config = AgentConfig(
            name=self.id,
            provider=self.provider,
            model=self.model,
            tools=self._build_tools_schema(),
            system_prompt=self.system_prompt,
            max_output_tokens=self.max_output_tokens,
            temperature=self.temperature,
            provider_base_url=self.provider_base_url,
            provider_llm_api=self.provider_llm_api,
            provider_kwargs=provider_kwargs if provider_kwargs else None,
            output_schema=self._output_json_schema,
            output_schema_name=self._output_schema_name,
            guardrail_max_retries=self.guardrail_max_retries,
        )

        # Create agent_run record using step.run() for durable execution
        # agent_run_id is now the same as execution_id
        agent_run_id = ctx.execution_id

        # Update context with conversation_id if provided
        if conversation_id:
            ctx.conversation_id = conversation_id
        else:
            ctx.conversation_id = await ctx.step.uuid("new_conversation_id")

        # Always call _agent_stream_function with streaming parameter
        from .stream import _agent_stream_function

        result = await _agent_stream_function(
            ctx,
            {
                "agent_run_id": agent_run_id,
                "name": self.id,
                "agent_config": agent_config,
                "input": input_data,
                "session_id": ctx.session_id,
                "conversation_id": ctx.conversation_id,
                "user_id": ctx.user_id,
                "streaming": streaming,
            },
        )

        return result

    def _build_tools_schema(self) -> list[Any]:
        """Build tools schema from tool list."""
        tools_schema = []
        for tool in self.tools:
            # Tools are Tool objects with _tool_description and _tool_parameters attributes
            # The tool name is the task's id
            if hasattr(tool, "id") and hasattr(tool, "_tool_parameters"):
                tools_schema.append(
                    {
                        "type": "function",
                        "name": tool.id,
                        "description": getattr(tool, "_tool_description", ""),
                        "parameters": tool._tool_parameters,
                    }
                )
            else:
                # LLM built-in tool
                tools_schema.append(tool)
        return tools_schema

    # Convenience methods for better DX
    async def run(
        self,
        input: str | list[dict[str, Any]],
        initial_state: BaseModel | dict[str, Any] | None = None,
        session_id: str | None = None,
        conversation_id: str | None = None,
        user_id: str | None = None,
        timeout: float | None = 600.0,
        **kwargs,
    ) -> AgentResult:
        """
        Run agent and return final result (non-streaming).

        This method cannot be called from within an execution context
        (e.g., from within a workflow).
        Use step.agent_run() or step.invoke_and_wait() to call agents from within workflows.

        Args:
            input: String or array of input items (multimodal)
            session_id: Optional session ID
            conversation_id: Optional conversation ID for conversation history
            user_id: Optional user ID
            timeout: Optional timeout in seconds (default: 600 seconds / 10 minutes)

        Returns:
            AgentResult with result, usage, tool_results, total_steps, and agent_run_id

        Raises:
            WorkflowTimeoutError: If the execution exceeds the timeout

        Example:
            result = await weather_agent.run("What's the weather in NYC?")
            print(result.result)
            print(result.usage)
            print(result.tool_results)
        """
        # Build agent-specific payload dict
        agent_payload = {
            "input": input,
            "session_id": session_id,
            "conversation_id": conversation_id,
            "user_id": user_id,
            "streaming": False,
            "provider_kwargs": kwargs,  # Pass kwargs to provider
        }

        # Call parent run() method with agent payload
        return await super().run(
            payload=agent_payload,
            initial_state=initial_state,
            session_id=session_id,
            user_id=user_id,
            timeout=timeout,
        )

    async def stream(
        self,
        input: str | list[dict[str, Any]],
        initial_state: BaseModel | dict[str, Any] | None = None,
        session_id: str | None = None,
        conversation_id: str | None = None,
        user_id: str | None = None,
        run_timeout_seconds: int | None = None,
        **kwargs,
    ) -> "StreamResult":
        """
        Start streaming agent response.

        This method cannot be called from within an execution context
        (e.g., from within a workflow).
        Use step.agent_run() or step.invoke_and_wait() to call agents from within workflows.

        Args:
            input: String or array of input items (multimodal)
            session_id: Optional session ID
            conversation_id: Optional conversation ID for conversation history
            user_id: Optional user ID

        Returns:
            StreamResult with event polling capabilities (wraps ExecutionHandle)

        Example:
            result = await agent.stream("What's the weather?")

            # Option 1: Iterate text chunks only
            async for chunk in result.text_chunks:
                print(chunk, end="")

            # Option 2: Get full events (text, tool calls, etc.)
            async for event in result.events:
                if event.event_type == "text_delta":
                    print(event.data.get("content", ""))
                elif event.event_type == "tool_call":
                    tool_name = (
                        event.data.get("tool_call", {})
                        .get("function", {})
                        .get("name")
                    )
                    print(f"Tool: {tool_name}")

            # Option 3: Get final accumulated text
            final_text = await result.text()

            # Option 4: Get complete result with usage, tool calls
            final_result = await result.result()
            print(final_result["result"])
            print(final_result["usage"])
        """
        # Check if we're in an execution context - fail if we are

        if _execution_context.get() is not None:
            raise RuntimeError(
                "agent.stream() cannot be called from within a workflow or agent. "
                "Use step.agent_run() or step.invoke_and_wait() to call agents "
                "from within workflows."
            )

        # Invoke agent task asynchronously (returns ExecutionHandle immediately)
        handle = await self.invoke(
            payload={
                "input": input,
                "session_id": session_id,
                "user_id": user_id,
                "streaming": True,
                "provider_kwargs": kwargs,  # Pass kwargs to provider
            },
            initial_state=initial_state,
            run_timeout_seconds=run_timeout_seconds,
        )

        # Wrap ExecutionHandle in StreamResult
        return StreamResult(handle)

    def with_input(
        self,
        input: str | list[dict[str, Any]],
        initial_state: BaseModel | dict[str, Any] | None = None,
        session_id: str | None = None,
        conversation_id: str | None = None,
        user_id: str | None = None,
        streaming: bool = False,
        run_timeout_seconds: int | None = None,
        **kwargs,
    ) -> AgentRunConfig:
        """
        Prepare agent for batch execution with all run() params.

        Args:
            input: Text string or messages array
            session_id: Optional session identifier
            user_id: Optional user identifier
            streaming: Whether to enable streaming (default: False)
            **kwargs: Additional params (temperature, max_tokens, etc.)

        Usage:
            results = await batch.run([
                grammar_agent.with_input(
                    "Check this",
                    session_id="sess_123",
                    user_id="user_456"
                ),
                tone_agent.with_input(
                    [{"role": "user", "content": "Check this"}],
                    streaming=True  # Enable streaming
                ),
            ])
        """
        return AgentRunConfig(
            agent=self,
            input=input,
            session_id=session_id,
            conversation_id=conversation_id,
            user_id=user_id,
            streaming=streaming,
            initial_state=initial_state,
            run_timeout_seconds=run_timeout_seconds,
            **kwargs,
        )
