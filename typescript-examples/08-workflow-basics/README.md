# Workflow Basics Example

This example demonstrates the fundamentals of Polos workflows - durable functions with automatic retry and state management.

## Features

- Creating workflows with `defineWorkflow()`
- Using TypeScript interfaces for typed input/output
- Using `ctx.step.run()` for durable step execution
- Automatic retry with exponential backoff
- Deterministic operations (`uuid`, `now`, `random`)
- Time-based waiting with `waitFor`
- Child workflow invocation with `ctx.step.invokeAndWait()`

## What are Workflows?

Workflows are functions created with `defineWorkflow()` that provide:

| Feature | Description |
|---------|-------------|
| **Durability** | Steps are automatically saved and replayed on resume |
| **Retry** | Failed steps are retried with exponential backoff |
| **Determinism** | Random values, UUIDs, timestamps are consistent on replay |
| **Composition** | Workflows can invoke other workflows |

## Files

- `workflows.ts` - Workflow definitions with TypeScript interfaces
- `main.ts` - Starts Polos and runs the workflow demos

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
   # Edit .env with your project ID
   ```

4. Run the example:
   ```bash
   npx tsx main.ts
   ```

## Workflow Examples

### Simple Workflow

```typescript
const simpleWorkflow = defineWorkflow<SimplePayload, unknown, SimpleResult>(
  { id: 'simple_workflow' },
  async (ctx, payload) => {
    const greeting = await ctx.step.run(
      'generate_greeting',
      () => `Hello, ${payload.name}!`,
    );
    return { message: greeting };
  },
);
```

### Order Processing Workflow

```typescript
const processOrder = defineWorkflow<OrderPayload, unknown, OrderResult>(
  { id: 'order_processor' },
  async (ctx, payload) => {
    await ctx.step.run('validate', () => { /* ... */ });
    await ctx.step.run('reserve', () => { /* ... */ });
    const confirmation = await ctx.step.uuid('confirmation');
    return {
      orderId: payload.orderId,
      status: 'completed',
      confirmationNumber: confirmation,
    };
  },
);
```

### Child Workflow Invocation

```typescript
const parentWorkflow = defineWorkflow<ParentPayload, unknown, ParentResult>(
  { id: 'parent_workflow' },
  async (ctx, payload) => {
    const results = [];
    for (let i = 0; i < payload.items.length; i++) {
      const childResult = await ctx.step.invokeAndWait(
        `validate_item_${i}`,
        validateAndEnrich,
        { data: payload.items[i], validationType: 'basic' },
      );
      results.push(childResult);
    }
    return { totalItems: payload.items.length, results };
  },
);
```

### Step Operations

```typescript
// Execute a function as a durable step
const result = await ctx.step.run('step_name', () => myFunction());

// Custom retry configuration
const result = await ctx.step.run(
  'unreliable_step',
  () => callExternalApi(),
  { maxRetries: 5, baseDelay: 2000, maxDelay: 30000 },
);

// Wait for a duration
await ctx.step.waitFor('cooldown', { seconds: 30 });

// Deterministic random (same value on replay)
const value = await ctx.step.random('random_value');

// Deterministic UUID (same value on replay)
const id = await ctx.step.uuid('unique_id');

// Deterministic timestamp (same value on replay)
const timestamp = await ctx.step.now('current_time');

// Invoke child workflow
const result = await ctx.step.invokeAndWait('step_key', childWorkflow, payload);
```

## Running Workflows

```typescript
import { Polos } from '@polos/sdk';
import { simpleWorkflow } from './workflows.js';

const polos = new Polos();
await polos.start();

// Invoke workflow and wait for result
const result = await simpleWorkflow.run(polos, { name: 'Alice' });
console.log(result); // { message: "Hello, Alice!" }

await polos.stop();
```

## Workflow Context

The `WorkflowContext` provides:

- `ctx.workflowId` - Current workflow ID
- `ctx.executionId` - Unique execution identifier
- `ctx.sessionId` - Session ID (if set)
- `ctx.userId` - User ID (if set)
- `ctx.step` - Step helper for durable operations

## Error Handling

Steps automatically retry on failure:

```typescript
// Default: 2 retries with 1-10 second backoff
const result = await ctx.step.run('my_step', () => myFunction());

// Custom retry settings
const result = await ctx.step.run(
  'my_step',
  () => myFunction(),
  {
    maxRetries: 5,     // Retry up to 5 times
    baseDelay: 2000,   // Start with 2 second delay
    maxDelay: 60000,   // Cap at 60 seconds
  },
);
```

If all retries fail, the workflow fails with `StepExecutionError`.
