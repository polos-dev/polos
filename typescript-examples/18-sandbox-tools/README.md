# 18 - Sandbox Tools

An agent that can write and execute code inside a Docker container using sandbox tools.

## What it demonstrates

- `sandboxTools()` creates 6 tools (exec, read, write, edit, glob, grep) that share a single Docker container
- The container is created lazily on first tool use and reused across all calls
- File operations go through the host filesystem via bind mount (fast)
- Commands run inside the container via `docker exec` (isolated)
- `cleanup()` removes the container when done

## Prerequisites

- **Docker** installed and running
- **Polos server** running (`polos-server start`)
- **Anthropic API key** (or swap to OpenAI in `agents.ts`)

## Setup

```bash
cp .env.example .env
# Edit .env with your project ID and API key
npm install
```

## Run

```bash
npx tsx main.ts
```

The agent will:
1. Create `hello.js` in the sandbox
2. Run it with `node hello.js`
3. Create `fibonacci.js`
4. Run it and print the results

## How it works

```typescript
import { defineAgent, sandboxTools } from '@polos/sdk';

const tools = sandboxTools({
  env: 'docker',
  docker: {
    image: 'node:20-slim',
    workspaceDir: '/path/to/host/dir',  // mounted at /workspace in container
  },
});

const agent = defineAgent({
  id: 'coding_agent',
  model: anthropic('claude-sonnet-4-5'),
  tools,
});
```

### Tool subset

Only include the tools you need:

```typescript
const tools = sandboxTools({
  env: 'docker',
  docker: { image: 'node:20-slim', workspaceDir: '.' },
  tools: ['exec', 'read', 'write'],  // skip edit, glob, grep
});
```

### Container options

```typescript
sandboxTools({
  env: 'docker',
  docker: {
    image: 'python:3.12-slim',
    workspaceDir: '/path/to/project',
    setupCommand: 'pip install -r requirements.txt',
    memory: '1g',
    cpus: '2',
    network: 'bridge',  // default is 'none' (no network)
    env: { NODE_ENV: 'test' },
  },
});
```
