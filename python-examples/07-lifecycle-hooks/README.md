# Lifecycle Hooks Example

This example demonstrates how to use lifecycle hooks to intercept and modify agent execution.

## Features

- Hook into agent lifecycle events
- Log execution metrics and timing
- Validate inputs before processing
- Modify tool payloads and outputs

## What are Lifecycle Hooks?

Hooks are functions that execute at specific points during agent execution:

| Hook | Timing | Use Cases |
|------|--------|-----------|
| `on_start` | Before agent execution begins | Input validation, logging, setup |
| `on_end` | After agent execution completes | Cleanup, metrics, notifications |
| `on_agent_step_start` | Before each LLM call | Rate limiting, logging |
| `on_agent_step_end` | After each LLM call | Response validation |
| `on_tool_start` | Before tool execution | Payload modification, authorization |
| `on_tool_end` | After tool execution | Output enrichment, logging |

## Files

- `hooks.py` - Hook function definitions
- `tools.py` - Example tools (search, calculator)
- `agents.py` - Agents with hooks attached
- `worker.py` - Worker that registers the agents
- `main.py` - Demo script that invokes agents to show hooks in action

## Running the Example

1. Start the Polos server:
   ```bash
   polos server start
   ```

2. Install dependencies:
   ```bash
   # Using uv (recommended)
   uv sync

   # Or using pip
   pip install -e .
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

4. Run the worker in one terminal:
   ```bash
   python worker.py
   ```

5. Run the demo in another terminal:
   ```bash
   python main.py
   ```

   Watch the **worker terminal** to see the hooks being triggered!

## Expected Output

In the worker terminal, you'll see hook logs like:
```
[14:30:45] Agent started - workflow: abc-123
  [Step 1] LLM call starting...
  [Step] LLM call completed
    [Tool] Executing: search
    [Tool] Completed: search
  [Step 2] LLM call starting...
  [Step] LLM call completed

[14:30:48] Agent completed
  Duration: 3.21s
  Steps: 2
  Tools used: ['search']
```

## Hook Examples

### Logging Hook
```python
@hook
def log_start(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    print(f"Agent started - workflow: {hook_ctx.workflow_id}")
    return HookResult.continue_with()
```

### Input Validation Hook
```python
@hook
def validate_input(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    payload = hook_ctx.current_payload or {}
    prompt = payload.get("prompt", "")

    if not prompt.strip():
        return HookResult.fail("Empty prompt not allowed")

    return HookResult.continue_with()
```

### Tool Payload Modification
```python
@hook
def add_timestamp(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    payload = hook_ctx.current_payload or {}
    modified = {**payload, "timestamp": datetime.now().isoformat()}
    return HookResult.continue_with(modified_payload=modified)
```

## Hook Context

The `HookContext` provides access to:

- `workflow_id` - Current workflow identifier
- `session_id` - Current session (if applicable)
- `steps` - Previous execution steps
- `current_tool` - Tool being executed (for tool hooks)
- `current_payload` - Input payload
- `current_output` - Output (for end hooks)

## Multiple Hooks

You can attach multiple hooks to each lifecycle event. They execute in order:

```python
agent = Agent(
    id="my_agent",
    on_start=[validate_input, log_start, setup_metrics],
    on_end=[log_end, cleanup],
)
```
