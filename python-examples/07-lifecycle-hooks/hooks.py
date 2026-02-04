"""Example lifecycle hooks for agents.

Hooks are functions that execute at specific points in the agent lifecycle:
- on_start: Before agent execution begins
- on_end: After agent execution completes
- on_agent_step_start: Before each LLM call
- on_agent_step_end: After each LLM call
- on_tool_start: Before tool execution
- on_tool_end: After tool execution
"""

import time
from datetime import datetime

from polos import hook, WorkflowContext, HookContext, HookResult


# Track execution metrics
execution_metrics: dict[str, dict] = {}


@hook
def log_start(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Log when agent execution starts."""
    workflow_id = hook_ctx.workflow_id
    execution_metrics[workflow_id] = {
        "start_time": time.time(),
        "step_count": 0,
        "tool_calls": [],
    }
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Agent started - workflow: {workflow_id}")
    return HookResult.continue_with()


@hook
def log_end(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Log when agent execution ends."""
    workflow_id = hook_ctx.workflow_id
    metrics = execution_metrics.get(workflow_id, {})
    duration = time.time() - metrics.get("start_time", time.time())
    step_count = metrics.get("step_count", 0)
    tool_calls = metrics.get("tool_calls", [])

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Agent completed")
    print(f"  Duration: {duration:.2f}s")
    print(f"  Steps: {step_count}")
    print(f"  Tools used: {tool_calls}")

    return HookResult.continue_with()


@hook
def log_step_start(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Log when an LLM step starts."""
    workflow_id = hook_ctx.workflow_id
    if workflow_id in execution_metrics:
        execution_metrics[workflow_id]["step_count"] += 1
        step_num = execution_metrics[workflow_id]["step_count"]
        print(f"\n  [Step {step_num}] LLM call starting...")

    return HookResult.continue_with()


@hook
def log_step_end(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Log when an LLM step ends."""
    print(f"  [Step] LLM call completed")
    return HookResult.continue_with()


@hook
def log_tool_start(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Log when a tool execution starts."""
    tool_name = hook_ctx.current_tool or "unknown"
    print(f"    [Tool] Executing: {tool_name}")
    return HookResult.continue_with()


@hook
def log_tool_end(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Log when a tool execution ends."""
    tool_name = hook_ctx.current_tool or "unknown"
    workflow_id = hook_ctx.workflow_id

    if workflow_id in execution_metrics:
        execution_metrics[workflow_id]["tool_calls"].append(tool_name)

    print(f"    [Tool] Completed: {tool_name}")
    return HookResult.continue_with()


@hook
def validate_input(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Validate input before agent execution starts."""
    # Access the input payload
    payload = hook_ctx.current_payload or {}
    prompt = payload.get("prompt", "")

    # Example validation: reject empty prompts
    if not prompt or not prompt.strip():
        return HookResult.fail("Empty prompt not allowed")

    # Example validation: reject very long prompts
    if len(prompt) > 10000:
        return HookResult.fail("Prompt too long (max 10000 characters)")

    return HookResult.continue_with()


@hook
def modify_tool_payload(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Modify tool payload before execution.

    Example: Add default values or sanitize inputs.
    """
    tool_name = hook_ctx.current_tool
    payload = hook_ctx.current_payload or {}

    # Example: Add timestamp to all tool calls
    modified = {**payload, "timestamp": datetime.now().isoformat()}

    return HookResult.continue_with(modified_payload=modified)


@hook
def enrich_tool_output(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Enrich tool output after execution.

    Example: Add metadata to tool results.
    """
    tool_name = hook_ctx.current_tool
    output = hook_ctx.current_output or {}

    # Example: Add source information to output
    modified = {
        **output,
        "_meta": {
            "tool": tool_name,
            "timestamp": datetime.now().isoformat(),
        },
    }

    return HookResult.continue_with(modified_output=modified)
