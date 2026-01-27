"""Hook execution infrastructure for lifecycle hooks.

Hooks are executed within a workflow execution context and support durable execution.
"""

from collections.abc import Callable

from ..core.context import WorkflowContext
from ..core.workflow import _execution_context
from ..types.types import AgentConfig
from .hook import HookAction, HookContext, HookResult


def _get_function_identifier(func: Callable, index: int) -> str:
    """Get a unique identifier for a function call.

    Uses function name if available, otherwise falls back to index.
    """
    if hasattr(func, "__name__") and func.__name__ != "<lambda>":
        return func.__name__
    return f"hook_{index}"


async def execute_hooks(
    hook_name: str,
    hooks: list[Callable],
    hook_context: HookContext,
    ctx: WorkflowContext,
) -> HookResult:
    """
    Execute a list of hooks sequentially and return the combined result.

    Hooks are executed within a workflow execution context. Each hook execution:
    1. Checks for cached result (for durable execution)
    2. If cached, returns cached result
    3. If not cached, executes hook and stores result

    Each hook can:
    - Return CONTINUE to proceed to the next hook
    - Return STOP to stop execution and return a value
    - Return ERROR to stop execution with an error

    Modifications from hooks are accumulated and applied in order.

    Args:
        hooks: List of hook callables (functions decorated with @hook)
        hook_context: Context to pass to hooks
        ctx: WorkflowContext for the current execution

    Returns:
        HookResult with action and any modifications

    Raises:
        ValueError: If not executed within a workflow execution context
    """
    if not hooks:
        return HookResult.continue_with()

    # Check we're in a workflow execution context
    exec_context = _execution_context.get()
    if not exec_context or not exec_context.get("execution_id"):
        raise ValueError("Hooks must be executed within a workflow or agent")

    # Accumulated modifications
    modified_agent_config = hook_context.agent_config
    modified_payload = hook_context.current_payload.copy() if hook_context.current_payload else {}
    modified_output = hook_context.current_output.copy() if hook_context.current_output else {}

    # Execute hooks sequentially
    for index, hook_func in enumerate(hooks):
        # Get function identifier for durable execution
        func_id = _get_function_identifier(hook_func, index)
        hook_result = await ctx.step.run(
            f"{hook_name}.{func_id}.{index}", hook_func, ctx, hook_context
        )

        # Ensure result is HookResult
        if not isinstance(hook_result, HookResult):
            hook_result = HookResult.fail(
                f"Hook '{func_id}' returned invalid result type: "
                f"{type(hook_result)}. Expected HookResult."
            )

        # Apply modifications
        if hook_result.modified_agent_config is not None:
            if modified_agent_config is None:
                modified_agent_config = hook_result.modified_agent_config
            else:
                # Merge modifications into existing config
                config_dict = modified_agent_config.model_dump()
                mod_dict = hook_result.modified_agent_config.model_dump()
                config_dict.update(mod_dict)
                modified_agent_config = AgentConfig.model_validate(config_dict)

        if hook_result.modified_payload is not None:
            modified_payload.update(hook_result.modified_payload)

        if hook_result.modified_output is not None:
            modified_output.update(hook_result.modified_output)

        # Update hook_context with accumulated modifications for next hook
        hook_context.agent_config = modified_agent_config
        hook_context.current_payload = modified_payload
        hook_context.current_output = modified_output

        # Check action
        if hook_result.action == HookAction.FAIL:
            # Fail execution - return error
            return hook_result

        # CONTINUE - proceed to next hook

    # All hooks completed with CONTINUE - return accumulated modifications
    return HookResult.continue_with(
        modified_agent_config=modified_agent_config,
        modified_payload=modified_payload,
        modified_output=modified_output,
    )
