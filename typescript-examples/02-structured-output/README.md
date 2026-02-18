# Structured Output Example

This example demonstrates how to use Zod schemas to get structured, typed responses from agents.

## Features

- Define output schemas using Zod
- Agent responses are automatically validated and parsed
- Type-safe access to response fields

## Files

- `agents.ts` - Agent definitions with output schemas
- `schemas.ts` - Zod schemas for structured output
- `main.ts` - Starts Polos, invokes the agent, and displays the structured result

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

4. Run the example:
   ```bash
   npx tsx main.ts
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
