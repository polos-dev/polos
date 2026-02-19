# State Persistence Example

This example demonstrates how workflows can maintain typed state that persists across executions.

## Features

- Typed state schemas with Zod
- State persistence across workflow invocations
- Initial state when starting workflows
- State accessible via `ctx.state`

## What is Workflow State?

Workflow state is a Zod schema that:
- Is automatically initialized from schema defaults
- Is saved when the workflow completes
- Can be initialized with custom values when starting a workflow
- Provides type safety and validation

## Files

- `workflows.ts` - Workflows with state schemas
- `main.ts` - Starts Polos and runs the state persistence demos

## Running the Example

1. Start the Polos server:
   ```bash
   polos server start
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

## Defining State Schemas

```typescript
import { z } from 'zod';

const CounterStateSchema = z.object({
  count: z.number().default(0),
  lastUpdated: z.string().nullable().default(null),
});

const ShoppingCartStateSchema = z.object({
  items: z.array(z.record(z.unknown())).default([]),
  total: z.number().default(0),
});
```

## Using State in Workflows

```typescript
const myWorkflow = defineWorkflow<Payload, MyState, Result>(
  { id: 'my_workflow', stateSchema: MyStateSchema },
  async (ctx, payload) => {
    // Read state
    const currentCount = ctx.state.counter;

    // Modify state (will be saved when workflow completes)
    ctx.state.counter += 1;
    ctx.state.items.push('new item');

    return { count: ctx.state.counter };
  },
);
```

## Initial State

When invoking a workflow, you can provide initial state:

```typescript
const handle = await polos.invoke(
  workflow.id,
  { increment: 5 },
  { initialState: { count: 100 } },
);
const result = await handle.getResult();
```

## State vs Steps

| Feature | State (`ctx.state`) | Steps (`ctx.step.run`) |
|---------|---------------------|------------------------|
| **Purpose** | Persistent data across invocations | Durable step execution |
| **Saved** | On workflow completion | After each step |
| **Typed** | Yes (Zod schemas) | Yes (return values) |
| **Mutable** | Yes, modify directly | No, create new values |
