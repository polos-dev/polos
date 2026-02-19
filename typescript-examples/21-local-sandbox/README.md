# 21 - Local Sandbox

An agent that can write and execute code directly on the host machine — no Docker required.

## What it demonstrates

- `sandboxTools({ env: 'local' })` creates tools that run on the host instead of inside a container
- Workspace directory is auto-provisioned at `~/.polos/workspaces/{projectId}/{sessionId}` — no manual `cwd` needed
- Exec security defaults to `approval-always` — every shell command suspends for user approval
- Same tool interface as Docker (`exec`, `read`, `write`, `edit`, `glob`, `grep`)

## Prerequisites

- **Polos server** running (`polos server start`)
- **Anthropic API key** (or swap to OpenAI in `agents.ts`)
- **No Docker required**

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

Every shell command the agent tries to run will pause and ask for your approval in the terminal.

## How it works

```typescript
import { defineAgent, sandboxTools } from '@polos/sdk';

const tools = sandboxTools({
  env: 'local',
  // cwd is auto-provisioned — no need to set it manually
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
| Workspace | Auto-provisioned (bind-mounted) | Auto-provisioned (`~/.polos/workspaces/...`) |
| Requires Docker | Yes | No |
| Performance | Container overhead | Native speed |
