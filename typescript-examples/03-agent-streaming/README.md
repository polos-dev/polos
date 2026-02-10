# Agent Streaming Example

This example demonstrates how to consume streaming responses from agents, including text chunks, full events, and accumulated text.

## Features

- Stream text chunks as they arrive from the LLM
- Stream all events (text deltas, tool calls, agent finish)
- Accumulate the final text with a single `await result.text()` call

## Files

- `agents.ts` - Storyteller agent definition
- `worker.ts` - Worker that registers and runs the agent
- `main.ts` - Three streaming examples: text chunks, full events, and final text

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
   # Edit .env with your settings
   ```

4. Run the worker:
   ```bash
   npx tsx worker.ts
   ```

5. Run main.ts to invoke the storyteller agent:
   ```bash
   npx tsx main.ts
   ```

   Alternatively, you can go to the Polos UI at http://localhost:5173/agents (List View) and invoke any of the agents.

## Streaming Modes

### Text Chunks
Iterate over `result.textChunks` to get raw text strings as they arrive:
```typescript
for await (const chunk of result.textChunks) {
  process.stdout.write(chunk);
}
```

### Full Events
Iterate over `result.events` to get all event types (text_delta, tool_call, agent_finish):
```typescript
for await (const event of result.events) {
  if (event.eventType === 'text_delta') {
    process.stdout.write(event.data['content']);
  }
}
```

### Final Text
Call `result.text()` to wait for completion and get the full accumulated text:
```typescript
const finalText = await result.text();
```
