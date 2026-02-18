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
| `onStart` | Before agent execution begins | Input validation, logging, setup |
| `onEnd` | After agent execution completes | Cleanup, metrics, notifications |
| `onAgentStepStart` | Before each LLM call | Rate limiting, logging |
| `onAgentStepEnd` | After each LLM call | Response validation |
| `onToolStart` | Before tool execution | Payload modification, authorization |
| `onToolEnd` | After tool execution | Output enrichment, logging |

## Files

- `hooks.ts` - Hook function definitions
- `tools.ts` - Example tools (search, calculator)
- `agents.ts` - Agents with hooks attached
- `main.ts` - Starts Polos and invokes agents to show hooks in action

## Running the Example

1. Start the Polos server:
   ```bash
   polos-server start
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your project ID and OpenAI API key
   ```

4. Run the example:
   ```bash
   npx tsx main.ts
   ```

## Expected Output

You'll see hook logs like:
```
[14:30:45] Agent started - workflow: abc-123
  [Step 1] LLM call starting...
  [Step] LLM call completed
    [Tool] Executing with payload: {"query":"Python programming"}
    [Tool] Completed with output: {"results":["..."],"total_count":3}
  [Step 2] LLM call starting...
  [Step] LLM call completed

[14:30:48] Agent completed
  Duration: 3.21s
  Steps: 2
  Tools used: [tool]
```

## Hook Examples

### Logging Hook
```typescript
const logStart = defineHook(async (ctx, hookCtx) => {
  console.log(`Agent started - workflow: ${ctx.workflowId}`);
  return HookResult.continue();
}, { name: 'log_start' });
```

### Input Validation Hook
```typescript
const validateInput = defineHook(async (ctx, hookCtx) => {
  const payload = hookCtx.currentPayload as Record<string, unknown>;
  const prompt = String(payload['prompt'] ?? '');

  if (!prompt.trim()) {
    return HookResult.fail('Empty prompt not allowed');
  }

  return HookResult.continue();
}, { name: 'validate_input' });
```

### Tool Payload Modification
```typescript
const addTimestamp = defineHook(async (ctx, hookCtx) => {
  const payload = (hookCtx.currentPayload ?? {}) as Record<string, unknown>;
  const modified = { ...payload, timestamp: new Date().toISOString() };
  return HookResult.continueWith({ modifiedPayload: modified });
}, { name: 'add_timestamp' });
```

## Hook Context

The `HookContext` provides access to:

- `workflowId` - Current workflow identifier
- `sessionId` - Current session (if applicable)
- `userId` - Current user (if applicable)
- `currentPayload` - Input payload
- `currentOutput` - Output (for end hooks)
- `phase` - Hook execution phase (`'onStart'` | `'onEnd'`)

## Multiple Hooks

You can attach multiple hooks to each lifecycle event. They execute in order:

```typescript
const agent = defineAgent({
  id: 'my_agent',
  model: openai('gpt-4o-mini'),
  onStart: [validateInput, logStart, setupMetrics],
  onEnd: [logEnd, cleanup],
  // ...
});
```
