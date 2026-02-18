# Thinking Agent Example

This example demonstrates agents that use chain-of-thought reasoning with structured output to solve problems step by step.

## Features

- Chain-of-thought reasoning with structured output
- Three specialized agents: general reasoning, math, and logic puzzles
- Structured `ReasoningOutput` with problem, thinking steps, conclusion, and confidence

## Files

- `agents.ts` - Three reasoning agent definitions with structured output
- `schemas.ts` - Zod schema for reasoning output
- `main.ts` - Starts Polos, invokes the thinking agent with a trick question, and streams the response

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

## Available Agents

| Agent | Description |
|-------|-------------|
| `thinking_agent` | General logical reasoning |
| `math_reasoner` | Step-by-step math problem solving |
| `logic_solver` | Logic puzzle solving with constraint tracking |
