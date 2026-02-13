# 21 - Local Sandbox

An agent that can write and execute code directly on the host machine — no Docker required.

## What it demonstrates

- `sandboxTools({ env: 'local' })` creates tools that run on the host instead of inside a container
- Exec security defaults to `approval-always` — every shell command suspends for user approval
- `pathRestriction` confines file operations (read, write, edit) to the workspace directory
- Symlink traversal is blocked when `pathRestriction` is set
- Same tool interface as Docker (`exec`, `read`, `write`, `edit`, `glob`, `grep`)

## Prerequisites

- **Polos server** running (`polos-server start`)
- **Anthropic API key** (or swap to OpenAI in `agents.ts`)
- **No Docker required**

## Setup

```bash
cp .env.example .env
# Edit .env with your project ID and API key
npm install
```

## Run

Terminal 1 — start the worker:
```bash
npx tsx worker.ts
```

Terminal 2 — invoke the agent:
```bash
npx tsx main.ts
```

Every shell command the agent tries to run will pause and ask for your approval in the terminal. File operations (read, write, edit) run without approval but are restricted to the `workspace/` directory.

## How it works

```typescript
import { defineAgent, sandboxTools } from '@polos/sdk';

const tools = sandboxTools({
  env: 'local',
  local: {
    cwd: '/path/to/workspace',
    pathRestriction: '/path/to/workspace',  // confine file access
  },
});

const agent = defineAgent({
  id: 'local_coding_agent',
  model: anthropic('claude-sonnet-4-5'),
  tools,
});
```

### Overriding exec security

By default, local mode requires approval for every command. You can use an allowlist to auto-approve safe commands:

```typescript
const tools = sandboxTools({
  env: 'local',
  local: { cwd: workspaceDir, pathRestriction: workspaceDir },
  exec: {
    security: 'allowlist',
    allowlist: ['node *', 'cat *', 'ls *', 'ls', 'echo *'],
  },
});
```

### Comparison with Docker sandbox (example 18)

| Feature | Docker (`env: 'docker'`) | Local (`env: 'local'`) |
|---|---|---|
| Isolation | Container | None (host machine) |
| Exec security default | No check (sandbox provides isolation) | `approval-always` |
| File access | Via bind mount | Direct filesystem |
| Path restriction | Container boundary | `pathRestriction` config |
| Requires Docker | Yes | No |
| Performance | Container overhead | Native speed |
