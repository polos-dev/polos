# Agent Streaming Example

This example demonstrates how to stream responses from agents in real-time.

## Features

- Real-time streaming of agent responses
- Iterate over text chunks as they arrive
- Access full events including tool calls
- Get final accumulated text

## Files

- `agents.py` - Agent definition
- `worker.py` - Worker that registers the agent
- `main.py` - Client demonstrating streaming consumption

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
   # Edit .env with your settings
   ```

4. Run the worker in one terminal:
   ```bash
   python worker.py
   ```

5. Run the streaming client in another terminal:
   ```bash
   python main.py
   ```

## Streaming APIs

### Text Chunks Only
```python
result = await agent.stream(client, "Tell me a story")
async for chunk in result.text_chunks:
    print(chunk, end="", flush=True)
```

### Full Events (including tool calls)
```python
result = await agent.stream(client, "What's the weather?")
async for event in result.events:
    if event.event_type == "text_delta":
        print(event.data.get("content", ""), end="")
    elif event.event_type == "tool_call":
        print(f"\n[Tool: {event.data.get('name')}]")
```

### Get Final Text (waits for full response to be available)
```python
result = await agent.stream(client, "Hello")
final_text = await result.text()
print(final_text)
```
