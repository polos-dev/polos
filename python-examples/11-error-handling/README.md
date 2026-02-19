# Error Handling Example

This example demonstrates error handling patterns for workflows.

## Features

- Automatic retry with exponential backoff
- Error recovery and graceful degradation
- Fallback patterns
- Circuit breaker pattern
- Compensation (rollback) pattern

## Files

- `workflows.py` - Workflow definitions with error handling
- `worker.py` - Worker that registers workflows

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

4. Run the worker:
   ```bash
   python worker.py
   ```

## Error Handling Patterns

### 1. Automatic Retry

Steps are automatically retried with exponential backoff:

```python
result = await ctx.step.run(
    "unreliable_step",
    call_external_api,
    max_retries=3,      # Retry up to 3 times
    base_delay=1.0,     # Start with 1s delay
    max_delay=30.0,     # Cap at 30s
)
```

### 2. Error Recovery

Handle errors gracefully and continue processing:

```python
for item in items:
    try:
        result = await ctx.step.run(f"process_{item}", process, item)
        results.append(result)
    except StepExecutionError as e:
        errors.append({"item": item, "error": str(e)})
        # Continue with other items
```

### 3. Fallback Pattern

Try primary method, fall back to secondary:

```python
try:
    result = await ctx.step.run("primary", primary_method, data)
except StepExecutionError:
    result = await ctx.step.run("fallback", fallback_method, data)
```

### 4. Circuit Breaker

Stop trying after too many failures:

```python
failures = 0
circuit_open = False

for item in items:
    if circuit_open:
        results.append({"status": "skipped"})
        continue

    try:
        result = await ctx.step.run(f"process", process, item)
        failures = 0  # Reset on success
    except StepExecutionError:
        failures += 1
        if failures >= threshold:
            circuit_open = True
```

### 5. Compensation (Saga) Pattern

Rollback on failure:

```python
completed = []
try:
    await ctx.step.run("step1", step1)
    completed.append("step1")
    await ctx.step.run("step2", step2)
    completed.append("step2")
except StepExecutionError:
    # Compensate in reverse order
    for step in reversed(completed):
        await ctx.step.run(f"undo_{step}", compensate, step)
```

## StepExecutionError

When a step fails after all retries, it raises `StepExecutionError`:

```python
from polos.core.workflow import StepExecutionError

try:
    await ctx.step.run("my_step", my_function)
except StepExecutionError as e:
    # Handle the failure
    print(f"Step failed: {e}")
```

## Best Practices

1. **Use appropriate retry settings** - More retries for transient failures, fewer for permanent errors
2. **Handle errors at the right level** - Catch errors where you can take meaningful action
3. **Log errors** - Always log errors for debugging
4. **Use compensation** - For operations that modify external state
5. **Fail fast** - Don't retry operations that can't succeed
