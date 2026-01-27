"""Guardrail execution infrastructure.

Guardrails are executed sequentially within a workflow execution context
and support durable execution.
"""

import json
from collections.abc import Callable
from typing import Any

from ..core.context import WorkflowContext
from ..core.workflow import _execution_context
from ..types.types import AgentConfig
from .guardrail import GuardrailContext, GuardrailResult
from .hook import HookAction


def _get_guardrail_identifier(guardrail: Callable | str, index: int) -> str:
    """Get a unique identifier for a guardrail.

    Uses function name if callable, otherwise uses a string identifier.
    """
    if isinstance(guardrail, str):
        # For string guardrails, use a truncated version
        return f"guardrail_string_{guardrail[:50]}"
    if hasattr(guardrail, "__name__") and guardrail.__name__ != "<lambda>":
        return guardrail.__name__
    return f"guardrail_{index}"


async def execute_guardrails(
    guardrail_name: str,
    guardrails: list[Callable | str],
    guardrail_context: GuardrailContext,
    ctx: WorkflowContext,
    agent_config: AgentConfig | None = None,
) -> GuardrailResult:
    """
    Execute a list of guardrails sequentially and return the combined result.

    Guardrails are executed within a workflow execution context. Each guardrail execution:
    1. Checks for cached result (for durable execution)
    2. If cached, returns cached result
    3. If not cached, executes guardrail and stores result

    Guardrails can be:
    - Callable: Functions decorated with @guardrail
    - str: String prompts evaluated using LLM with structured output

    Each guardrail can:
    - Return CONTINUE to proceed to the next guardrail
    - Return FAIL to stop execution with an error

    Modifications from guardrails are accumulated and applied in order.

    Args:
        guardrails: List of guardrail callables or strings
        guardrail_context: Context to pass to guardrails
        ctx: WorkflowContext for the current execution
        agent_config: Optional agent config (model, provider, etc.) for string guardrails

    Returns:
        GuardrailResult with action and any modifications

    Raises:
        ValueError: If not executed within a workflow execution context
    """
    if not guardrails:
        return GuardrailResult.continue_with()

    # Check we're in a workflow execution context
    exec_context = _execution_context.get()
    if not exec_context or not exec_context.get("execution_id"):
        raise ValueError("Guardrails must be executed within a workflow execution context")

    # Accumulated modifications
    if guardrail_context.content is not None:
        if isinstance(guardrail_context.content, str):
            modified_content = guardrail_context.content
        else:
            modified_content = guardrail_context.content.copy()
    else:
        modified_content = None

    modified_tool_calls = (
        guardrail_context.tool_calls.copy() if guardrail_context.tool_calls else []
    )
    modified_llm_config = guardrail_context.llm_config.copy()

    # Execute guardrails sequentially
    for index, guardrail in enumerate(guardrails):
        # Get identifier for durable execution
        guardrail_id = _get_guardrail_identifier(guardrail, index)

        # Update guardrail context with accumulated modifications
        guardrail_context.content = modified_content
        guardrail_context.tool_calls = modified_tool_calls
        guardrail_context.llm_config = modified_llm_config

        # Execute guardrail (callable or string)
        if isinstance(guardrail, str):
            # String guardrail: evaluate using LLM
            if not agent_config:
                raise ValueError("agent_config is required for string guardrails")

            guardrail_result = await _execute_string_guardrail(
                guardrail_name=f"{guardrail_name}:{index}",
                guardrail_string=guardrail,
                guardrail_context=guardrail_context,
                ctx=ctx,
                agent_config=agent_config,
                index=index,
            )
        elif callable(guardrail):
            guardrail_result = await ctx.step.run(
                f"{guardrail_name}.{guardrail_id}.{index}", guardrail, ctx, guardrail_context
            )
        else:
            raise TypeError(
                f"Guardrail at index {index} is neither callable nor string: {type(guardrail)}"
            )

        # Ensure result is GuardrailResult
        if not isinstance(guardrail_result, GuardrailResult):
            guardrail_result = GuardrailResult.fail(
                f"Guardrail '{guardrail_id}' returned invalid result type: "
                f"{type(guardrail_result)}. Expected GuardrailResult."
            )

        # Apply modifications
        if guardrail_result.modified_content is not None:
            modified_content = guardrail_result.modified_content

        if guardrail_result.modified_tool_calls is not None:
            modified_tool_calls = guardrail_result.modified_tool_calls

        if guardrail_result.modified_llm_config is not None:
            modified_llm_config.update(guardrail_result.modified_llm_config)

        # Check action
        if guardrail_result.action == HookAction.FAIL:
            # Fail execution - return error
            return guardrail_result

        # CONTINUE - proceed to next guardrail

    # All guardrails completed with CONTINUE - return accumulated modifications
    return GuardrailResult.continue_with(
        modified_content=modified_content,
        modified_tool_calls=modified_tool_calls,
        modified_llm_config=modified_llm_config,
    )


async def _execute_string_guardrail(
    guardrail_name: str,
    guardrail_string: str,
    guardrail_context: GuardrailContext,
    ctx: WorkflowContext,
    agent_config: dict[str, Any],
    index: int,
) -> GuardrailResult:
    """Execute a string guardrail using LLM with structured output.

    Args:
        guardrail_string: The guardrail prompt/instruction
        guardrail_context: Context containing LLM response to validate
        ctx: WorkflowContext for the current execution
        agent_config: Agent configuration (model, provider, etc.)

    Returns:
        GuardrailResult indicating pass/fail
    """
    import json

    from ..llm import _llm_generate

    # Create JSON schema for structured output: {passed: bool, reason: Optional[str]}
    guardrail_output_schema = {
        "type": "object",
        "properties": {"passed": {"type": "boolean"}, "reason": {"type": "string", "default": ""}},
        "required": ["passed", "reason"],
        "additionalProperties": False,
    }

    # Build the evaluation prompt
    # Include the guardrail instruction and the LLM response to validate
    llm_content = guardrail_context.content
    if isinstance(llm_content, str):
        content_to_validate = llm_content
    else:
        content_to_validate = json.dumps(llm_content) if llm_content else ""

    if not content_to_validate:
        return GuardrailResult.continue_with()

    evaluation_prompt = f"""{guardrail_string}

Please evaluate the following LLM response against the criteria above.
Return a JSON object with "passed" (boolean) and optionally "reason"
(string if the guardrail fails).

LLM Response to evaluate:
{content_to_validate}"""

    # Prepare agent config for guardrail evaluation
    # Use the agent's model, provider, etc., but override output_schema
    config_dict = agent_config.model_dump()
    config_dict["output_schema"] = guardrail_output_schema
    config_dict["output_schema_name"] = "GuardrailEvaluationResult"
    guardrail_agent_config = AgentConfig.model_validate(config_dict)

    # Call _llm_generate to evaluate the guardrail
    llm_result = await _llm_generate(
        ctx,
        {
            "agent_run_id": guardrail_context.agent_run_id,
            "agent_config": guardrail_agent_config.model_dump(),
            "input": evaluation_prompt,
            "agent_step": 0,  # Guardrail evaluation doesn't count as agent step
            "guardrails": None,  # Don't recurse guardrails on guardrail evaluation
            "guardrail_max_retries": 0,
        },
    )

    return await ctx.step.run(
        f"{guardrail_name}.{guardrail_string[:50]}.{index}", _parse_llm_guardrail_result, llm_result
    )


async def _parse_llm_guardrail_result(llm_result: dict[str, Any]) -> GuardrailResult:
    """Parse the LLM result and return a GuardrailResult."""
    # Parse the structured output
    result_content = llm_result.get("content", "")
    if not result_content:
        return GuardrailResult.fail("Guardrail evaluation returned empty response")

    try:
        evaluation_result = (
            json.loads(result_content) if isinstance(result_content, str) else result_content
        )

        passed = evaluation_result.get("passed", False)
        reason = evaluation_result.get("reason")

        if passed:
            return GuardrailResult.continue_with()
        else:
            error_message = reason or "Guardrail validation failed"
            return GuardrailResult.fail(error_message)
    except (json.JSONDecodeError, TypeError, AttributeError) as e:
        # If parsing fails, treat as failure
        return GuardrailResult.fail(f"Failed to parse guardrail evaluation result: {str(e)}")
