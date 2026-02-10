# Conversational Chat Example

This example demonstrates an interactive chat agent with tools, streaming responses, and conversation history.

## Features

- Interactive REPL-style chat loop with streaming responses
- Conversation history maintained via `conversationId`
- Three tools: current time, weather lookup, and calculator
- Tool call indicators displayed inline during streaming

## Files

- `agents.ts` - Chat assistant agent definition with tools
- `tools.ts` - Tool definitions (get_current_time, get_weather, calculator)
- `worker.ts` - Worker that registers and runs the agent and tools
- `chat.ts` - Interactive chat client with streaming

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

5. Run the chat client:
   ```bash
   npx tsx chat.ts
   ```

## Example Session

```
You: What time is it?
Assistant:
  [Using get_current_time...]
The current time is 2:30 PM UTC.

You: What's the weather like in Tokyo?
Assistant:
  [Using get_weather...]
It's 22°C and Sunny in Tokyo right now!

You: What's 42 * 17?
Assistant:
  [Using calculator...]
42 × 17 = 714

You: quit
Goodbye!
```
