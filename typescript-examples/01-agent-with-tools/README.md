# Weather Agent Example

A simple example demonstrating the basics of Polos:
- Creating an agent with a tool
- Running a worker to execute the agent

## Prerequisites

1. **Polos Server** - The orchestrator that manages workflow execution
2. **Node.js 18+**
3. **Polos project ID** - Get this from the UI page http://localhost:5173/settings
4. **OpenAI API Key** - For the weather agent

## Setup

### 1. Start the Polos Server

Install and start the Polos server (orchestrator):

```bash
# Install polos-server
curl -fsSL https://install.polos.dev/install.sh | bash

# Start the server
polos-server start
```

Example output:

```bash
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Polos server is running!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Orchestrator API: http://127.0.0.1:8080
  UI:              http://127.0.0.1:5173
  Project ID:      8348be0b-bee2-4b28-bd7a-3d5a873c01ab
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
# You can get this from the output printed by `polos-server start` or from the UI page at
# http://localhost:5173/projects/settings (the ID will be below the project name 'default')
POLOS_PROJECT_ID=my-project

# Required: OpenAI API key for the agent
OPENAI_API_KEY=sk-...

# Optional: Your deployment ID
# This is a way to signal versions to Polos.
# As you make revisions to your agents, you can use deployment_id to run multiple versions of your agents if needed.
POLOS_DEPLOYMENT_ID=v1

# Optional: Orchestrator URL (defaults to http://localhost:8080)
# POLOS_API_URL=http://localhost:8080
```

## Running the Example

### Terminal 1: Start the Worker

The worker executes workflows and agents:

```bash
npx tsx worker.ts
```

You should see:
```
Starting worker...
  Project ID: <my-project>
  Agents: [weather_agent]
  Press Ctrl+C to stop
```

### Terminal 2: Run the Example

In a separate terminal, run:

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

1. **main.ts** invokes `weather_agent` with input "What's the weather like in New York?"
2. **Polos Server** receives the workflow (agent) and queues it for execution
3. **worker.ts** picks up the agent request and executes it:
   - Starts the weather agent to get weather information
   - The agent uses the `get_weather` tool
4. The result is returned through Polos Server to the caller

## Files

- `agents.ts` - Defines the `weather_agent` agent
- `tools.ts` - Defines the `get_weather` tool with mock weather data
- `worker.ts` - Runs the worker that executes workflows
- `main.ts` - Invokes the workflow and displays results
