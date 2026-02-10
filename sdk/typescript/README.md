# @polos/sdk

TypeScript SDK for building durable AI agents and workflows.

## Installation

```bash
npm install @polos/sdk
```

Install the AI provider(s) you need:

```bash
# For Anthropic Claude
npm install @ai-sdk/anthropic

# For OpenAI
npm install @ai-sdk/openai

# For Google Gemini
npm install @ai-sdk/google
```

## Quick Start

### Define an Agent

```typescript
import { defineAgent, defineTool, maxSteps } from '@polos/sdk';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

// Define a tool with Zod input schema
const searchTool = defineTool({
  id: 'search',
  description: 'Search for information',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
  }),
}, async (ctx, input) => {
  // `ctx` is a WorkflowContext, `input` is typed from inputSchema
  const results = await ctx.step.run('search', () =>
    searchDatabase(input.query)
  );
  return results;
});

// Define the agent
const researchAgent = defineAgent({
  id: 'research-assistant',
  model: anthropic('claude-sonnet-4'),
  systemPrompt: 'You are a helpful research assistant.',
  tools: [searchTool],
  stopConditions: [maxSteps({ count: 10 })],
});

// Run the agent (requires a client)
const client = PolosClient.fromEnv();
const result = await researchAgent.run(client, { input: 'What is the capital of France?' });
console.log(result);
```

### Define a Workflow

```typescript
import { defineWorkflow, PolosClient } from '@polos/sdk';
import { z } from 'zod';

const processOrder = defineWorkflow({
  id: 'process-order',
  payloadSchema: z.object({
    orderId: z.string(),
    items: z.array(z.string()),
  }),
}, async (ctx, payload) => {
  // Durable step - result is persisted and replayed on retry
  const validated = await ctx.step.run('validate', () =>
    validateOrder(payload.orderId)
  );

  // Invoke a child workflow and wait for its result
  const processed = await ctx.step.invokeAndWait(
    'process-items',       // step key
    'process-items-wf',    // workflow ID (or Workflow object)
    { items: payload.items }
  );

  return { status: 'completed', orderId: payload.orderId };
});

// Run via client
const client = PolosClient.fromEnv();
const result = await client.run(processOrder, {
  orderId: '123',
  items: ['a', 'b'],
});
```

### Run a Worker

The `Worker` registers your workflows with the orchestrator and receives tasks for execution.

```typescript
import { Worker } from '@polos/sdk';
import { processOrder } from './workflows';
import { researchAgent } from './agents';

const worker = new Worker({
  apiUrl: process.env.POLOS_API_URL!,
  apiKey: process.env.POLOS_API_KEY!,
  projectId: process.env.POLOS_PROJECT_ID!,
  deploymentId: 'my-deployment',
  workflows: [processOrder, researchAgent],
});

await worker.run(); // blocks until shutdown (SIGINT/SIGTERM)
```

## Client API

```typescript
import { PolosClient } from '@polos/sdk';

// Explicit configuration
const client = new PolosClient({
  apiUrl: 'https://api.polos.dev',
  apiKey: 'your-api-key',
  projectId: 'your-project',
});

// Or from environment variables (POLOS_API_URL, POLOS_API_KEY, POLOS_PROJECT_ID)
const client = PolosClient.fromEnv();

// Invoke a workflow (fire and forget) — returns an ExecutionHandle
const handle = await client.invoke(myWorkflow, { key: 'value' });
const result = await handle.getResult();

// Invoke and wait for result in one call
const result = await client.run(myWorkflow, { key: 'value' });

// Publish an event
await client.events.publish('my-topic', { data: { key: 'value' } });

// Stream events from a topic
for await (const event of client.events.streamTopic('my-topic')) {
  console.log(event);
}

// Create a schedule (cron)
await client.schedules.create('my-workflow', '0 8 * * *');
```

## Features

### Hooks

Hooks intercept workflow execution at lifecycle points. Use `defineHook()` for reusable hooks, or pass inline functions to `onStart`/`onEnd`.

```typescript
import { defineHook, HookResult, defineWorkflow } from '@polos/sdk';

const loggingHook = defineHook(async (ctx, hookCtx) => {
  console.log(`Workflow ${hookCtx.workflowId} starting`);
  return HookResult.continue();
}, { name: 'logging-hook' });

const myWorkflow = defineWorkflow({
  id: 'my-workflow',
  onStart: loggingHook,
  onEnd: async (ctx, hookCtx) => {
    return HookResult.continue();
  },
}, async (ctx, payload) => {
  // ...
});
```

Agents support additional hooks: `onAgentStepStart`, `onAgentStepEnd`, `onToolStart`, `onToolEnd`.

### Guardrails

Guardrails validate LLM outputs after each generation. They can approve, reject, modify, or retry the output.

```typescript
import { defineGuardrail, defineAgent } from '@polos/sdk';

const contentFilter = defineGuardrail(async (ctx, guardrailCtx) => {
  if (containsBadContent(guardrailCtx.content)) {
    return GuardrailResult.retry('Please rephrase without inappropriate content.');
  }
  return GuardrailResult.continue();
}, { name: 'content-filter' });

const agent = defineAgent({
  id: 'safe-agent',
  model: anthropic('claude-sonnet-4-20250514'),
  guardrails: [contentFilter],
  guardrailMaxRetries: 2,
  // ...
});
```

### Stop Conditions

Stop conditions control when an agent stops its execution loop.

```typescript
import { defineAgent, maxSteps, maxTokens, executedTool, hasText } from '@polos/sdk';

const agent = defineAgent({
  id: 'my-agent',
  model: anthropic('claude-sonnet-4-20250514'),
  stopConditions: [
    maxSteps({ count: 10 }),                      // stop after 10 steps
    maxTokens({ limit: 5000 }),                    // stop after 5000 total tokens
    executedTool({ toolNames: ['final-answer'] }), // stop once tool is called
    hasText({ texts: ['DONE'] }),                  // stop when text appears in output
  ],
  // ...
});
```

### Streaming

Use `agent.stream()` to get real-time text chunks and events as the agent runs.

```typescript
const client = PolosClient.fromEnv();

const stream = await agent.stream(client, { input: 'Tell me a story' });

// Iterate over text chunks
for await (const chunk of stream.textChunks) {
  process.stdout.write(chunk);
}

// Or get all text at once
const text = await stream.text();

// Or get the full result
const result = await stream.result();
```

### State Management

Workflows can declare a typed state schema. State is mutable during execution and persisted across retries.

```typescript
import { defineWorkflow } from '@polos/sdk';
import { z } from 'zod';

const counterWorkflow = defineWorkflow({
  id: 'counter',
  payloadSchema: z.object({ increment: z.number() }),
  stateSchema: z.object({ count: z.number().default(0) }),
}, async (ctx, payload) => {
  ctx.state.count += payload.increment;
  return { count: ctx.state.count };
});
```

### Events

Publish and subscribe to events for cross-workflow communication.

```typescript
// Publish from a client
await client.events.publish('order-events', {
  eventType: 'order_created',
  data: { orderId: '123' },
});

// Trigger a workflow on an event topic
const handler = defineWorkflow({
  id: 'order-handler',
  triggerOnEvent: 'order-events',
}, async (ctx, payload) => {
  // payload contains the event data
});

// Stream events
for await (const event of client.events.streamTopic('order-events')) {
  console.log(event.eventType, event.data);
}
```

### Schedules

Run workflows on a cron schedule.

```typescript
// Static schedule (defined on the workflow)
const dailyReport = defineWorkflow({
  id: 'daily-report',
  schedule: '0 8 * * *', // 8 AM daily
}, async (ctx, payload) => {
  // payload is a SchedulePayload with timestamp, lastTimestamp, etc.
});

// Dynamic schedule (created via client)
await client.schedules.create('my-workflow', '*/5 * * * *'); // every 5 minutes
```

## Key Concepts

| Concept | Function | Requires Client? |
|---------|----------|-----------------|
| Workflow | `defineWorkflow(config, handler)` | No |
| Agent | `defineAgent(config)` | No |
| Tool | `defineTool(config, handler)` | No |
| Hook | `defineHook(handler, options?)` | No |
| Guardrail | `defineGuardrail(handler, options?)` | No |
| Worker | `new Worker(config)` | No (has its own connection) |
| Invoke | `client.invoke(workflow, payload)` | Yes |
| Run | `client.run(workflow, payload)` | Yes |
| Agent Run | `agent.run(client, { input })` | Yes |
| Agent Stream | `agent.stream(client, { input })` | Yes |
| Events | `client.events.publish(topic, data)` | Yes |
| Schedules | `client.schedules.create(wf, cron)` | Yes |
| Step Run | `ctx.step.run(key, fn)` | No (context provided) |
| Step Invoke | `ctx.step.invokeAndWait(key, wf, payload)` | No (context provided) |

## Development

```bash
npm run build       # Build the package
npm test            # Run tests
npm run typecheck   # Type-check without emitting
npm run lint        # Lint with ESLint
```
