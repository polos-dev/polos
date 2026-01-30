"""Built-in LLM generation function for executing LLM API calls."""

from typing import Any

from ..core.context import WorkflowContext
from ..core.workflow import _execution_context
from ..middleware.guardrail import GuardrailContext
from ..middleware.guardrail_executor import execute_guardrails
from ..middleware.hook import HookAction
from ..types.types import AgentConfig
from ..utils.agent import convert_input_to_messages
from .providers import get_provider


async def _llm_generate(ctx: WorkflowContext, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Durable function for LLM response generation with guardrail support and retry logic.

    Must be executed within a workflow execution context. Uses step_outputs for durability.

    Args:
        ctx: WorkflowContext for the current execution
        payload: Dictionary containing:
            - agent_run_id: Optional[str]
            - agent_config: Dict with provider, model, tools, system_prompt, etc.
            - input: Union[str, List[Dict]] - Input data
            - messages: Optional[List[Dict]] - Pre-formatted messages (used for retries)
            - agent_step: int - Step in agent conversation (1 = first, 2 = after tools, etc.)
            - guardrails: Optional[List[Callable]] - List of guardrail callables
            - guardrail_max_retries: int - Max retries for guardrail failures (default: 0)

    Returns:
        Dictionary with LLM result containing content, tool_calls, usage, etc.
    """
    # Check we're in a workflow execution context
    exec_context = _execution_context.get()
    if not exec_context or not exec_context.get("execution_id"):
        raise ValueError("_llm_generate must be executed within a workflow execution context")

    # Extract payload
    agent_run_id = payload.get("agent_run_id")
    agent_config = AgentConfig.model_validate(payload.get("agent_config"))
    input_data = payload.get("input")
    agent_step = payload.get("agent_step", 1)
    guardrails = payload.get("guardrails")  # List of guardrail callables
    guardrail_max_retries = payload.get("guardrail_max_retries", 2)
    tool_results = payload.get("tool_results")  # Optional tool results in OpenAI format

    # Get LLM provider
    provider_kwargs = {}
    if agent_config.provider_base_url:
        provider_kwargs["base_url"] = agent_config.provider_base_url
    if agent_config.provider_llm_api:
        provider_kwargs["llm_api"] = agent_config.provider_llm_api
    provider = get_provider(agent_config.provider, **provider_kwargs)

    # Convert input to messages (without system_prompt - provider will handle it)
    messages = convert_input_to_messages(input_data, system_prompt=None)

    guardrail_retry_count = 0

    # Guardrail retry loop
    while guardrail_retry_count <= guardrail_max_retries:
        # Call the LLM API via provider using step.run() for durable execution
        # Pass agent_config and tool_results to provider
        # Include provider_kwargs if provided
        provider_kwargs = agent_config.provider_kwargs or {}

        llm_response = await ctx.step.run(
            f"llm_generate:{agent_step}",
            provider.generate,
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
        )
        response_content = llm_response.content
        response_tool_calls = llm_response.tool_calls if llm_response.tool_calls else None
        usage = llm_response.usage if llm_response.usage else None
        raw_output = llm_response.raw_output if llm_response.raw_output else None

        llm_result = {
            "agent_run_id": agent_run_id,
            "status": "completed",
            "content": response_content,
            "tool_calls": response_tool_calls,
            "usage": usage,
            "raw_output": raw_output,
        }

        # If no guardrails, return immediately
        if not guardrails:
            return llm_result

        # Execute guardrails on the LLM result
        guardrail_context = GuardrailContext(
            content=llm_result.get("content"),
            tool_calls=llm_result.get("tool_calls"),
            agent_workflow_id=None,
            agent_run_id=agent_run_id,
            llm_config=agent_config,
        )

        # Execute guardrails using the existing execute_guardrails function
        guardrail_result = await execute_guardrails(
            f"{agent_step}.guardrail",
            guardrails,
            guardrail_context,
            ctx,
            agent_config=agent_config,
        )

        # Check guardrail result
        if guardrail_result.action == HookAction.FAIL:
            # Guardrail failed - check if we can retry
            guardrail_error_message = (
                guardrail_result.error_message or "Guardrail validation failed"
            )
            if guardrail_retry_count >= guardrail_max_retries:
                # Exhausted retries - raise exception with error message
                raise Exception(
                    f"Guardrail failed after {guardrail_max_retries} retries. "
                    f"Last error: {guardrail_error_message}"
                )

            # Add feedback to messages for retry
            feedback_message = (
                f"Previous attempt failed guardrail validation: "
                f"{guardrail_error_message}. Please revise your response "
                f"accordingly."
            )
            messages.append({"role": "user", "content": feedback_message})
            guardrail_retry_count += 1
            continue  # Retry LLM generation

        # CONTINUE - all guardrails passed, apply accumulated modifications
        if guardrail_result.modified_content is not None:
            llm_result["content"] = guardrail_result.modified_content
        if guardrail_result.modified_tool_calls is not None:
            llm_result["tool_calls"] = guardrail_result.modified_tool_calls

        return llm_result

    # Should not reach here, but just in case
    raise Exception(f"Failed to generate valid response after {guardrail_max_retries} retries")
