# Thinking Agent Example

This example demonstrates a chain-of-thought reasoning agent that shows its thinking process.

## Features

- Step-by-step reasoning with visible thought process
- Complex problem decomposition
- Structured reasoning output

## Files

- `agents.py` - Thinking agent definition
- `worker.py` - Worker that registers the agent

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

5. Run main.py to invoke the thinking agent.
   ```bash
   python main.py
   ```

   Alternatively, you can go to the Polos UI at http://localhost:5173/agents (List View) and invoke any of the agents.

## Example Usage

**Input:**
```
A farmer has 17 sheep. All but 9 run away. How many sheep does the farmer have left?
```

**Output:**
```
Let me think through this step by step:

1. The farmer starts with 17 sheep
2. The phrase "all but 9 run away" means "all except 9"
3. This means 9 sheep did NOT run away
4. Therefore, 9 sheep remain

The farmer has 9 sheep left.

This is a classic trick question - many people subtract 9 from 17 to get 8,
but the wording "all but 9" means 9 stay behind.
```
