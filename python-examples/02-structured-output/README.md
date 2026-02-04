# Structured Output Example

This example demonstrates how to use Pydantic models to get structured, typed responses from agents.

## Features

- Define output schemas using Pydantic models
- Agent responses are automatically validated and parsed
- Type-safe access to response fields

## Files

- `agents.py` - Agent definition with output schema
- `worker.py` - Worker that registers and runs the agent
- `schemas.py` - Pydantic models for structured output

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

4. Run the worker:
   ```bash
   python worker.py
   ```

5. Run main.py to invoke the movie_reviewer agent.
   ```bash
   python main.py
   ```

   Alternatively, you can go to the Polos UI at http://localhost:5173/agents (List View) and invoke any of the agents.

## Example Input/Output

**Input:**
```
Review the movie "The Matrix"
```

**Output (structured):**
```json
{
  "title": "The Matrix",
  "rating": 9,
  "genre": "Sci-Fi/Action",
  "summary": "A groundbreaking film that redefined the sci-fi genre...",
  "pros": ["Innovative visual effects", "Thought-provoking philosophy"],
  "cons": ["Complex plot may confuse some viewers"],
  "recommendation": "Must watch for any sci-fi fan"
}
```
