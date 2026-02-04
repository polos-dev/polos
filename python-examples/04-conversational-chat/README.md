# Conversational Chat Agent Example

This example demonstrates a conversational chat agent with:
- Streaming responses
- Tool execution during conversation
- Conversation history/memory via conversation_id

## Features

- Interactive chat loop with streaming responses
- Tools that the agent can call during conversation
- Conversation context maintained across messages using session_id
- Real-time display of tool calls and results

## Files

- `agents.py` - Chat agent with tools
- `tools.py` - Tools available to the agent
- `worker.py` - Worker that registers the agent
- `chat.py` - Interactive chat client

## Running the Example

1. Start the Polos server:
   ```bash
   polos-server start
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
   # Edit .env with your settings
   ```

4. Run the worker in one terminal:
   ```bash
   python worker.py
   ```

5. Run the interactive chat in another terminal:
   ```bash
   python chat.py
   ```

## Example Conversation

```
You: What time is it?
Assistant: [Using get_current_time tool...]
The current time is 3:45 PM.

You: What's the weather in Tokyo?
Assistant: [Using get_weather tool...]
The weather in Tokyo is sunny with a temperature of 22°C.

You: Thanks! Can you remember my name is Alice?
Assistant: Of course! I'll remember that your name is Alice.

You: What's my name?
Assistant: Your name is Alice, as you just told me!
```
