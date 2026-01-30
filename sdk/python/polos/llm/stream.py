"""Built-in LLM streaming function."""

from typing import Any

from ..core.context import WorkflowContext
from ..core.workflow import _execution_context
from ..types.types import AgentConfig
from ..utils.agent import convert_input_to_messages
from ..utils.client_context import get_client_or_raise
from .providers import get_provider


async def _llm_stream(ctx: WorkflowContext, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Durable function for LLM streaming.

    Must be executed within a workflow execution context. Uses step_outputs for durability.

    Args:
        ctx: WorkflowContext for the current execution
        payload: Dictionary containing:
            - agent_run_id: str
            - agent_config: Dict with provider, model, tools, system_prompt, etc.
            - input: Union[str, List[Dict]] - Input data
            - agent_step: int - Step in agent conversation (1 = first, 2 = after tools, etc.)

    Returns:
        Dictionary with streaming result containing content, tool_calls, usage, etc.
    """
    # Check we're in a workflow execution context
    exec_context = _execution_context.get()
    if not exec_context or not exec_context.get("execution_id"):
        raise ValueError("_llm_stream must be executed within an agent")

    # Extract payload
    agent_run_id = payload["agent_run_id"]
    agent_config = AgentConfig.model_validate(payload["agent_config"])
    input_data = payload["input"]
    agent_step = payload.get("agent_step", 1)
    tool_results = payload.get("tool_results")  # Optional tool results in OpenAI format

    # Get LLM provider
    provider_kwargs = {}
    if agent_config.provider_base_url:
        provider_kwargs["base_url"] = agent_config.provider_base_url
    if agent_config.provider_llm_api:
        provider_kwargs["llm_api"] = agent_config.provider_llm_api
    provider = get_provider(agent_config.provider, **provider_kwargs)

    # Convert input to messages format (without system_prompt - provider will handle it)
    messages = convert_input_to_messages(input_data, system_prompt=None)

    topic = f"workflow:{agent_run_id}"

    # Stream from LLM API and publish events
    # Call helper function to handle streaming using step.run() for durable execution
    streaming_result = await ctx.step.run(
        f"llm_stream:{agent_step}",
        _stream_from_provider,
        ctx=ctx,
        provider=provider,
        messages=messages,
        agent_config=agent_config,
        tool_results=tool_results,
        topic=topic,
        agent_step=agent_step,
        agent_run_id=agent_run_id,
    )

    return streaming_result


async def _stream_from_provider(
    ctx: WorkflowContext,
    provider: Any,
    messages: list[dict[str, Any]],
    agent_config: AgentConfig,
    tool_results: list[dict[str, Any]] | None,
    topic: str,
    agent_step: int,
    agent_run_id: str,
) -> dict[str, Any]:
    """
    Helper function to stream from provider and publish events.

    Returns:
        Dictionary with chunk_index, response_content, response_tool_calls, usage, raw_output
    """
    from ..features.events import publish as publish_event

    chunk_index = 0
    response_content = None
    response_tool_calls = None
    usage = None
    raw_output = None
    polos_client = get_client_or_raise()

    # Publish start event
    # This is needed for invalidating events in the case of failures during
    # agent streaming
    # If the consumer seems stream_start event for the same agent_step,
    # discard previous events for that agent_step
    await publish_event(
        client=polos_client,
        topic=topic,
        event_type="stream_start",
        data={"step": agent_step},
    )

    # Stream from provider
    # Pass agent_config and tool_results to provider
    # Include provider_kwargs if provided
    provider_kwargs = agent_config.provider_kwargs or {}
    async for event in provider.stream(
        messages=messages,
        model=agent_config.model,
        tools=agent_config.tools,
        temperature=agent_config.temperature,
        max_tokens=agent_config.max_output_tokens,
        top_p=agent_config.top_p,
        agent_config=agent_config.model_dump(mode="json"),
        tool_results=tool_results,
        output_schema=agent_config.output_schema,
        output_schema_name=agent_config.output_schema_name,
        **provider_kwargs,
    ):
        # Handle error events
        if event.get("type") == "error":
            error_msg = event.get("data", {}).get("error", "Unknown error")
            raise RuntimeError(f"LLM streaming error: {error_msg}")

        # Event is already in normalized format from provider
        normalized_chunk = event
        event_type = None

        # Accumulate response data for llm_calls update
        if normalized_chunk["type"] == "text_delta":
            event_type = "text_delta"
            if response_content is None:
                response_content = ""
            content = normalized_chunk["data"].get("content", "")
            if content:
                response_content += content
        elif normalized_chunk["type"] == "tool_call":
            event_type = "tool_call"
            if response_tool_calls is None:
                response_tool_calls = []
            tool_call = normalized_chunk["data"].get("tool_call")
            if tool_call:
                response_tool_calls.append(tool_call)
        elif normalized_chunk["type"] == "done":
            usage = normalized_chunk["data"].get("usage")
            raw_output = normalized_chunk["data"].get("raw_output")

        # Publish chunk as event (skip "done" events)
        if normalized_chunk["type"] != "done" and event_type:
            await publish_event(
                client=polos_client,
                topic=topic,
                event_type=event_type,
                data={
                    "step": agent_step,
                    "chunk_index": chunk_index,
                    "content": normalized_chunk["data"].get("content"),
                    "tool_call": normalized_chunk["data"].get("tool_call"),
                    "usage": normalized_chunk["data"].get("usage"),
                    "_metadata": {
                        "execution_id": agent_run_id,
                        "workflow_id": ctx.workflow_id,
                    },
                },
            )
            chunk_index += 1

    return {
        "agent_run_id": agent_run_id,
        "chunk_count": chunk_index,
        "status": "completed",
        "content": response_content,
        "tool_calls": response_tool_calls if response_tool_calls else None,
        "usage": usage if usage else None,
        "raw_output": raw_output if raw_output else None,
    }
