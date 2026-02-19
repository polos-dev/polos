# Weather Agent Example

A simple example demonstrating the basics of Polos:
- Creating an agent with a tool
- Running it with the unified `Polos` class

## Prerequisites

1. **Polos Server** - The orchestrator that manages workflow execution
2. **Node.js 18+**
3. **Polos project ID** - Get this from the UI page http://localhost:5173/settings
4. **OpenAI API Key** - For the weather agent

## Setup

### 1. Start the Polos Server

Install and start the Polos server (orchestrator):

```bash
# Install polos
curl -fsSL https://install.polos.dev/install.sh | bash

# Start the server
polos server start
```

The server runs at `http://localhost:8080` by default.

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create a `.env` file:

```bash
# Required: Your project ID.
POLOS_PROJECT_ID=my-project

# Required: OpenAI API key for the agent
OPENAI_API_KEY=sk-...

# Optional: Orchestrator URL (defaults to http://localhost:8080)
# POLOS_API_URL=http://localhost:8080
```

## Running the Example

```bash
npx tsx main.ts
```

You should see:
```
Invoking weather_agent...
Result: 'The weather in New York is...'
```

Alternatively, you can go to the Polos UI at [http://localhost:5173/agents](http://localhost:5173/agents) and invoke any of the agents.

## What's Happening?

1. **main.ts** starts a `Polos` instance (registers agents, starts worker in background)
2. Invokes `weather_agent` with input "What's the weather like in New York?"
3. The agent uses the `get_weather` tool to get weather information
4. The result is returned and displayed

## Files

- `agents.ts` - Defines the `weather_agent` agent
- `tools.ts` - Defines the `get_weather` tool with mock weather data
- `main.ts` - Starts Polos, invokes the agent, and displays results
