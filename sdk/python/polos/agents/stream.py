"""Agent stream function (called from agent._agent_execute)."""

import json
import logging
import os
from typing import Any

from pydantic import BaseModel

from ..core.context import AgentContext
from ..core.workflow import _WORKFLOW_REGISTRY
from ..llm import _llm_generate, _llm_stream
from ..middleware.hook import HookAction, HookContext
from ..middleware.hook_executor import execute_hooks
from ..types.types import (
    AgentResult,
    BatchStepResult,
    BatchWorkflowInput,
    Step,
    ToolCall,
    ToolResult,
    Usage,
)
from ..utils.serializer import json_serialize, serialize
from .conversation_history import add_conversation_history, get_conversation_history

logger = logging.getLogger(__name__)


async def _agent_stream_function(ctx: AgentContext, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Agent stream function (called from agent._agent_execute).

    This function orchestrates the agent conversation:
    1. Executes LLM stream/generate and gets results
    2. If tool calls are present, executes tools and publishes results
    3. Makes successive LLM calls with tool results until no more tool calls
    4. Publishes finish event

    Payload:
    {
        "agent_run_id": str,  # This is the execution_id
        "name": str,
        "agent_config": {
            "provider": str,
            "model": str,
            "tools": List[Dict],
            "system_prompt": Optional[str],
            "max_output_tokens": Optional[int],
            "temperature": Optional[float]
        },
        "input": Union[str, List[Dict]],  # String or array of input items
        "streaming": bool  # Whether to stream or return final result
    }
    """
    agent_run_id = ctx.execution_id  # Use execution_id from context
    agent_config = payload["agent_config"]
    streaming = payload.get("streaming", True)  # Default to True for backward compatibility
    input_data = payload.get("input")

    result = {
        "agent_run_id": agent_run_id,
        "conversation_id": ctx.conversation_id,
        "result": None,
        "tool_results": [],
        "total_steps": 0,
        "usage": {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
        },
    }

    # Get agent instance for hooks
    agent = _WORKFLOW_REGISTRY.get(ctx.agent_id)

    # Main agent streaming logic starts here
    input_data = payload.get("input")
    if input_data is None:
        raise ValueError("Input is required in payload")

    # Retrieve conversation history if enabled (cache it to avoid repeated DB reads)
    cached_history_messages = None
    if agent and agent.conversation_history > 0 and ctx.conversation_id:
        history_records = await get_conversation_history(
            conversation_id=ctx.conversation_id,
            agent_id=ctx.agent_id,
            deployment_id=ctx.deployment_id,
            limit=agent.conversation_history,
        )
        # Convert history records to message format
        # History records have: id, session_id, agent_id, role, content, created_at, agent_run_id
        cached_history_messages = []
        for record in history_records:
            # content is already JSON-serializable (string or dict/list for structured content)
            cached_history_messages.append(
                {
                    "role": record.get("role"),
                    "content": record.get("content"),
                }
            )

    # Build conversation history (for successive LLM calls)
    conversation_messages = []

    # Prepend cached conversation history if available
    if cached_history_messages:
        conversation_messages.extend(cached_history_messages)

    # Add current input to conversation
    if isinstance(input_data, str):
        conversation_messages.append({"role": "user", "content": input_data})
    elif isinstance(input_data, list):
        conversation_messages.extend(input_data)

    # Loop: LLM call -> tool execution -> LLM call with results
    agent_step = 1
    final_input_tokens = 0
    final_output_tokens = 0
    final_total_tokens = 0
    last_llm_result_content = None
    all_tool_results = []
    steps: list[Step] = []
    end_steps = False
    # Get stop conditions from agent object (all are callables)
    stop_conditions = agent.stop_conditions if agent else []
    tool_results = None
    parsed_result = None
    checked_structured_output = False

    # Check for max_steps limit unless overridden by explicit max_steps stop condition
    # Check if any stop condition is max_steps (configured callable from max_steps())
    from .stop_conditions import max_steps as max_steps_fn

    has_max_steps_condition = False
    for sc in stop_conditions:
        # Check if it's a configured callable from max_steps()
        if hasattr(sc, "__stop_condition_fn__"):
            # It's a configured callable - check if it's from max_steps
            if sc.__stop_condition_fn__ is max_steps_fn:
                has_max_steps_condition = True
                break
        # Also check if it's the max_steps function itself (unlikely but possible)
        elif sc is max_steps_fn:
            has_max_steps_condition = True
            break

    if has_max_steps_condition:
        max_steps = None
    else:
        max_steps = int(os.environ.get("POLOS_AGENT_MAX_STEPS", "10"))  # Configurable safety limit

    while not end_steps and (max_steps is None or agent_step <= max_steps):
        current_iteration_tool_results = []
        # Execute on_agent_step_start hooks
        if agent and agent.on_agent_step_start:
            hook_context = HookContext(
                workflow_id=ctx.agent_id,
                session_id=ctx.session_id,
                user_id=ctx.user_id,
                agent_config=agent_config,
                steps=steps.copy(),
                current_payload={"step": agent_step, "messages": conversation_messages},
            )
            hook_result = await execute_hooks(
                f"{agent_step}.hook.on_agent_step_start",
                agent.on_agent_step_start,
                hook_context,
                ctx,
            )

            # Apply modifications
            if hook_result.modified_payload and "messages" in hook_result.modified_payload:
                conversation_messages = hook_result.modified_payload["messages"]

            # Check hook action
            if hook_result.action == HookAction.FAIL:
                break
            if hook_result.action == HookAction.FAIL:
                from ..core.workflow import StepExecutionError

                raise StepExecutionError(hook_result.error_message or "Hook execution failed")

        # Get guardrails from agent
        guardrails = agent.guardrails if agent else None
        guardrail_max_retries = (
            agent.guardrail_max_retries if agent else (agent_config.guardrail_max_retries or 2)
        )

        # Use _llm_generate if streaming=False OR guardrails are present
        # Guardrails need the full response to validate, so we can't stream incrementally
        # If streaming=False, we want the complete result, not incremental chunks
        use_llm_generate = not streaming or guardrails

        if use_llm_generate:
            llm_result = await _llm_generate(
                ctx,
                {
                    "agent_run_id": agent_run_id,
                    "agent_config": agent_config,
                    "input": conversation_messages,
                    "agent_step": agent_step,
                    "guardrails": guardrails,
                    "guardrail_max_retries": guardrail_max_retries,
                    "tool_results": tool_results,  # Tool results from previous iteration
                },
            )

            if guardrails and streaming and llm_result.get("content"):
                # Emit one text_delta event with full response for clients who are streaming
                await ctx.step.publish_event(
                    f"llm_generate:text_delta:{agent_step}",
                    topic=f"workflow:{agent_run_id}",
                    event_type="text_delta",
                    data={
                        "step": agent_step,
                        "chunk_index": 1,
                        "content": llm_result.get("content"),
                        "_metadata": {
                            "execution_id": agent_run_id,
                            "workflow_id": ctx.workflow_id,
                        },
                    },
                )
        else:
            # No guardrails - use streaming
            llm_result = await _llm_stream(
                ctx,
                {
                    "agent_run_id": agent_run_id,
                    "agent_config": agent_config,
                    "input": conversation_messages,
                    "agent_step": agent_step,
                    "tool_results": tool_results,  # Tool results from previous iteration
                },
            )

        tool_results = None  # Reset tool results for next iteration

        usage_dict = llm_result.get("usage")
        if usage_dict:
            final_input_tokens += usage_dict.get("input_tokens", 0)
            final_output_tokens += usage_dict.get("output_tokens", 0)
            final_total_tokens += usage_dict.get("total_tokens", 0)

        last_llm_result_content = llm_result.get("content")
        tool_calls = llm_result.get("tool_calls") or []
        if not llm_result.get("raw_output"):
            raise Exception(
                f"LLM failed to generate output: agent_id={ctx.agent_id}, agent_step={agent_step}"
            )

        # Execute tools in batch and publish results

        # Prepare batch workflow list
        batch_workflows = []
        tool_call_list = []  # List of tool calls for publishing results
        # tool_results is preserved from previous iteration (or None on first iteration)
        # Will be set to new results if tools are executed in this iteration
        tool_results_list = []  # Initialize to empty list
        tool_results_recorded_list = []

        for idx, tool_call in enumerate(tool_calls):
            # Tool call format: {"id": "...", "type": "function",
            # "function": {"name": "...", "arguments": "..."}}
            if (
                isinstance(tool_call, dict)
                and "function" in tool_call
                and isinstance(tool_call["function"], dict)
            ):
                tool_name = tool_call["function"].get("name")
                tool_args_str = tool_call["function"].get("arguments", "{}")
                tool_call_id = tool_call.get("id")
                tool_call_call_id = tool_call.get("call_id")
            else:
                continue

            if not tool_name:
                continue

            # Find the tool workflow in registry
            tool_workflow = _WORKFLOW_REGISTRY.get(tool_name)
            if not tool_workflow:
                logger.warning("Tool '%s' not found in registry", tool_name)
                continue

            # Parse tool arguments
            try:
                tool_args = (
                    json.loads(tool_args_str) if isinstance(tool_args_str, str) else tool_args_str
                )
            except Exception:
                tool_args = {}

            # Execute on_tool_start hooks
            if agent and agent.on_tool_start:
                hook_context = HookContext(
                    workflow_id=ctx.agent_id,
                    session_id=ctx.session_id,
                    user_id=ctx.user_id,
                    agent_config=agent_config,
                    steps=steps.copy(),
                    current_tool=tool_name,
                    current_payload=tool_args,
                )
                hook_result = await execute_hooks(
                    f"{agent_step}.hook.on_tool_start.{idx}", agent.on_tool_start, hook_context, ctx
                )

                # Apply modifications
                if hook_result.modified_payload:
                    tool_args.update(hook_result.modified_payload)

                # Check hook action
                if hook_result.action == HookAction.FAIL:
                    from ..core.workflow import StepExecutionError

                    raise StepExecutionError(hook_result.error_message or "Hook execution failed")

            # Add to batch
            batch_workflows.append(BatchWorkflowInput(id=tool_name, payload=tool_args))
            tool_call_list.append(
                {
                    "tool_call_id": tool_call_id,
                    "tool_call_call_id": tool_call_call_id,
                    "tool_name": tool_name,
                    "tool_call": tool_call,
                }
            )

        # Execute all tools in batch
        if len(batch_workflows) > 0:
            tool_results_list: list[BatchStepResult] = await ctx.step.batch_invoke_and_wait(
                f"execute_tools:step_{agent_step}", batch_workflows
            )

            # Publish results and build conversation
            tool_results_recorded_list = []
            for i, batch_tool_result in enumerate(tool_results_list):
                tool_result = (
                    batch_tool_result.result
                    if batch_tool_result.success
                    else f"Error: {batch_tool_result.error}"
                )
                tool_spec = batch_workflows[i]
                tool_name = tool_spec.id
                tool_call_info = tool_call_list[i]

                tool_call_id = tool_call_info.get("tool_call_id")
                tool_call_call_id = tool_call_info.get("tool_call_call_id")

                tool_result_schema = (
                    (f"{tool_result.__class__.__module__}.{tool_result.__class__.__name__}")
                    if batch_tool_result.success
                    else None
                )
                if tool_result_schema and tool_result_schema.startswith("builtins."):
                    tool_result_schema = None

                # Execute on_tool_end hooks
                if agent and agent.on_tool_end:
                    hook_context = HookContext(
                        workflow_id=ctx.agent_id,
                        session_id=ctx.session_id,
                        user_id=ctx.user_id,
                        agent_config=agent_config,
                        steps=steps.copy(),
                        current_tool=tool_name,
                        current_payload=tool_spec.payload,
                        current_output=tool_result,
                    )
                    hook_result = await execute_hooks(
                        f"{agent_step}.hook.on_tool_end.{idx}", agent.on_tool_end, hook_context, ctx
                    )

                    # Apply modifications
                    if hook_result.modified_output is not None:
                        tool_result = hook_result.modified_output

                    # Check hook action
                    if hook_result.action == HookAction.FAIL:
                        from ..core.workflow import StepExecutionError

                        raise StepExecutionError(
                            hook_result.error_message or "Hook execution failed"
                        )

                # Serialize and add tool result to conversation
                tool_output = serialize(tool_result)
                tool_json_output = json_serialize(tool_result)

                current_iteration_tool_results.append(
                    {
                        "type": "function_call_output",
                        "call_id": tool_call_call_id,
                        "output": tool_json_output,
                    }
                )

                tool_results_recorded_list.append(
                    {
                        "tool_name": tool_name,
                        "status": "completed",
                        "result": tool_output,
                        "result_schema": tool_result_schema,
                        "tool_call_id": tool_call_id,
                        "tool_call_call_id": tool_call_call_id,
                    }
                )

            all_tool_results.extend(tool_results_recorded_list)

            # Set tool_results for next iteration
            tool_results = current_iteration_tool_results

        # Convert tool_calls to ToolCall objects
        tool_calls_list = []
        for tc in tool_calls:
            if isinstance(tc, dict) and "function" in tc and isinstance(tc["function"], dict):
                tool_calls_list.append(ToolCall.model_validate(tc))

        # Convert tool_results to ToolResult objects
        tool_results_list = []
        for tr in tool_results_recorded_list:
            if isinstance(tr, dict):
                tool_results_list.append(ToolResult.model_validate(tr))

        # Convert usage to Usage object
        usage_obj = None
        usage_dict = llm_result.get("usage")
        if usage_dict:
            usage_obj = Usage.model_validate(usage_dict)

        steps.append(
            Step(
                step=agent_step,
                content=last_llm_result_content,
                tool_calls=tool_calls_list,
                tool_results=tool_results_list,
                usage=usage_obj,
                raw_output=llm_result.get("raw_output"),
            )
        )

        # Execute on_agent_step_end hooks
        if agent and agent.on_agent_step_end:
            hook_context = HookContext(
                workflow_id=ctx.agent_id,
                session_id=ctx.session_id,
                user_id=ctx.user_id,
                agent_config=agent_config,
                steps=steps.copy(),
                current_payload={"step": agent_step, "messages": conversation_messages},
                current_output=steps[-1],
            )
            hook_result = await execute_hooks(
                f"{agent_step}.hook.on_agent_step_end", agent.on_agent_step_end, hook_context, ctx
            )

            # Apply modifications
            if hook_result.modified_output:
                new_result = hook_result.modified_output
                steps[-1] = new_result

            # Check hook action
            if hook_result.action == HookAction.FAIL:
                from ..core.workflow import StepExecutionError

                raise StepExecutionError(hook_result.error_message or "Hook execution failed")

        # No tool results, we're done
        if tool_results is None or len(tool_results) == 0:
            end_steps = True

        # Evaluate stop conditions (if any)
        if stop_conditions and not end_steps:
            from .stop_conditions import StopConditionContext

            # Create stop condition context
            stop_ctx = StopConditionContext(
                steps=steps.copy(),
                agent_id=ctx.agent_id,
                agent_run_id=agent_run_id,
            )

            for idx, stop_condition in enumerate(stop_conditions):
                # Call stop condition using step.run() for durable execution
                if hasattr(stop_condition, "__stop_condition_name__"):
                    func_name = stop_condition.__stop_condition_name__
                else:
                    func_name = "unknown"
                should_stop = await ctx.step.run(
                    f"{agent_step}.stop_condition.{func_name}.{idx}", stop_condition, stop_ctx
                )

                if should_stop:
                    # Stop condition met; break loop
                    end_steps = True
                    break

        if end_steps:
            # Parse structured output
            parsed_result, parse_success = await _parse_structured_output(
                last_llm_result_content, agent.result_output_schema if agent else None
            )

            if checked_structured_output and not parse_success:
                # LLM failed to generate valid output again, raise an exception
                raise Exception(
                    f"LLM failed to generate valid structured output: "
                    f"agent_id={ctx.agent_id}, agent_step={agent_step}"
                )

            checked_structured_output = True

            # If parsing failed and output_schema is present, try to fix it with llm_generate
            if not parse_success and agent and agent.result_output_schema:
                # Reset end_steps and try to fix the output
                end_steps = False

                # Simply include the last incorrect output in the conversation messages
                conversation_messages = llm_result.get("raw_output")

                # Add a user message asking to fix the output
                schema_json = json.dumps(agent.result_output_schema.model_json_schema(), indent=2)
                fix_prompt = (
                    f"The previous response was not valid JSON matching the "
                    f"required schema. Please reformat your response to be valid "
                    f"JSON that strictly conforms to this schema:\n\n{schema_json}\n\n"
                    f"Please provide ONLY valid JSON that matches the schema, "
                    f"with no additional text or formatting."
                )
                conversation_messages.append({"role": "user", "content": fix_prompt})

        if not end_steps:
            # If it's a structured output correction step, we've already created
            # the conversation messages
            # So we don't need to add the raw output again
            if checked_structured_output is False:
                # conversation_messages.extend(llm_result.get("raw_output"))
                conversation_messages = llm_result.get("raw_output")

            # Increment agent_step for next LLM call
            agent_step += 1

    # Prepare result and update agent_run status to completed
    result.update(
        {
            "agent_run_id": agent_run_id,
            "conversation_id": ctx.conversation_id,
            "result": last_llm_result_content,
            "tool_results": all_tool_results,
            "total_steps": agent_step,
            "usage": {
                "input_tokens": final_input_tokens,
                "output_tokens": final_output_tokens,
                "total_tokens": final_total_tokens,
            },
        }
    )

    if parsed_result and agent and agent.result_output_schema:
        parsed_result_schema = (
            f"{parsed_result.__class__.__module__}.{parsed_result.__class__.__name__}"
        )
    else:
        parsed_result_schema = None

    # Store conversation history if enabled
    if agent and ctx.conversation_id:
        # Store user message (input_data is already in a JSON-serializable format)
        await ctx.step.run(
            "add_conversation_history_user",
            add_conversation_history,
            ctx=ctx,
            conversation_id=ctx.conversation_id,
            agent_id=ctx.agent_id,
            role="user",
            content=input_data,
            agent_run_id=str(agent_run_id),
            conversation_history_limit=agent.conversation_history,
        )

        # Store assistant response
        if last_llm_result_content:
            await ctx.step.run(
                "add_conversation_history_assistant",
                add_conversation_history,
                ctx=ctx,
                conversation_id=ctx.conversation_id,
                agent_id=ctx.agent_id,
                role="assistant",
                content=last_llm_result_content,
                agent_run_id=str(agent_run_id),
                conversation_history_limit=agent.conversation_history,
            )

    # Return typed AgentResult for SDK callers
    raw_tool_results = result.get("tool_results", [])
    typed_tool_results = [
        ToolResult.model_validate(tr) for tr in raw_tool_results if isinstance(tr, dict)
    ]
    usage_dict = result.get("usage", {}) or {}
    usage_obj = Usage(
        input_tokens=usage_dict.get("input_tokens", 0),
        output_tokens=usage_dict.get("output_tokens", 0),
        total_tokens=usage_dict.get("total_tokens", 0),
    )

    agent_result = AgentResult(
        agent_run_id=str(result.get("agent_run_id")),
        conversation_id=str(result.get("conversation_id")),
        result=parsed_result,
        result_schema=parsed_result_schema,
        tool_results=typed_tool_results,
        total_steps=int(result.get("total_steps", 0)),
        usage=usage_obj,
    )
    return agent_result


async def _parse_structured_output(output: str, output_schema: type[BaseModel] | None = None):
    """
    Parse structured output if output_schema is provided.

    Returns:
        Tuple of (parsed_output, success_flag) where success_flag is True if parsing succeeded,
        or False if parsing failed and output_schema is present.
    """
    parsed_output = output
    success = True

    if output_schema and output:
        if isinstance(output, str):
            try:
                # Parse JSON dict into Pydantic model instance
                parsed_output = output_schema.model_validate_json(output)
            except Exception as e:
                # If parsing fails and output_schema is present, return False
                logger.warning("Failed to parse structured output: %s", e)
                success = False
        elif isinstance(output, dict):
            try:
                # Parse JSON dict into Pydantic model instance
                parsed_output = output_schema.model_validate(output)
            except Exception as e:
                # If parsing fails and output_schema is present, return False
                logger.warning("Failed to parse structured output: %s", e)
                success = False

    return parsed_output, success
