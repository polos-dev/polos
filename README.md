<p align="center">
  <img src=".github/assets/logo.png" alt="Polos Logo" width="200">
</p>

<p align="center">
  <strong>The open-source runtime for AI agents</strong>
</p>

<p align="center">
  <a href="https://github.com/polos-dev/polos">
    <img src="https://img.shields.io/github/stars/polos-dev/polos?style=social" alt="GitHub Stars">
  </a>
  <a href="https://polos.dev/docs">
    <img src="https://img.shields.io/badge/docs-polos.dev-0891B2?style=flat-square&logo=read-the-docs&logoColor=white" alt="Documentation">
  </a>
  <a href="https://discord.gg/ZAxHKMPwFG">
    <img src="https://img.shields.io/discord/1468012115859345611?color=2D6A4F&label=community&logo=discord&logoColor=white&style=flat-square" alt="Discord">
  </a>
</p>

<p align="center">
  You write the agent. Polos handles sandboxes, durability, approvals, triggers, and observability.<br>
  Built for developers shipping agents to production.
</p>

<p align="center">
  <b>⭐ Star us to support the project!</b>
</p>

---

## Quick Start

```
$ curl -fsSL https://install.polos.dev/install.sh | bash

$ npx create-polos my-project
  ✓ Project name: my-project
  ✓ LLM provider: Anthropic
  ✓ Done!

$ cd my-project && polos dev
  ✓ Polos server started → http://localhost:5173
  ✓ Worker connected - agents: coding_agent, assistant_agent
  Watching for changes...

$ polos run coding_agent
> Build a REST API with Express and user auth

  [Agent writes files, runs commands, builds the project - all sandboxed]
```

Open [http://localhost:5173](http://localhost:5173) for the dashboard. 📖 **[Full Quick Start Guide →](https://polos.dev/docs/quickstart)**

---

## The Polos CLI

Once you're running, the CLI gives you full control:

```bash
polos dev                    # Start server + worker with hot reload
polos run <agent>            # Start an interactive session with an agent
polos agent list             # List available agents
polos tool list              # List available tools
polos logs <agent>           # Stream logs from agent runs
```

---

## Building Agents Is Easy. Running Them in Production Is Hard.

| Challenge | Typical agent framework | With Polos |
|-----------|------------------------|------------|
| **Sandboxing** | None - DIY or run unsandboxed | Docker, E2B + built-in tools (exec, files, search) |
| **Durability** | Agent crashes, start over | Auto-retry, resume from exact step |
| **Approvals** | Build it yourself | Slack, UI, terminal - one tap |
| **Triggers** | Glue code for every webhook | Built-in: HTTP, webhooks, cron, events |
| **Observability** | Grep through logs | Full tracing, every tool call, every decision |
| **Cost** | Re-run failed LLM calls from scratch | Durable execution, Prompt caching, 60-80% savings |

---

## What You Get

### Sandboxed Execution

Agents run in isolated Docker containers, E2B, or cloud VMs. Every sandbox ships with built-in tools - `exec`, `read`, `write`, `edit`, `glob`, `grep`, `web_search` - so your agent can run commands, navigate codebases, and browse the web out of the box. No tool code to write, no sandbox lifecycle to manage. Just pass `sandboxTools()` and go.

### Durable Workflows

Automatic retries and state persistence. Resume from the exact step that failed. Prompt caching with 60-80% cost savings. Concurrency control across agents - no API rate limit chaos.

### Human-in-the-Loop

Approval flows for any tool call. Reach your team via Slack, Discord, email. Configurable rules for what needs approval. Paused agents consume zero compute.

### Triggers

Every agent gets a webhook URL out of the box - point GitHub, JIRA, Salesforce, or any system at it. Plus HTTP API, cron scheduling, event-driven triggers, and built-in Slack integration to run agents from chat.

### Observability

OpenTelemetry tracing for every step, tool call, and approval. Full execution history. Visual dashboard for monitoring and debugging.

### Bring Your Stack

Build agents on Polos with any LLM - OpenAI, Anthropic, Google, and more via Vercel AI SDK and LiteLLM. Or bring existing agents from CrewAI, LangGraph, and Mastra and get Polos's durability, observability, and sandboxing without rewriting anything. Python or TypeScript. Open source - run anywhere.

---

## Show Me the Code

**Define an agent with access to sandbox (Python)**
```python
from polos import Agent, sandbox_tools, SandboxToolsConfig, DockerConfig

sandbox = sandbox_tools(SandboxToolsConfig(
    env="docker",
    docker=DockerConfig(image="node:20-slim", memory="2g"),
))

coding_agent = Agent(
    id="coding_agent",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt="You are a coding agent.",
    tools=sandbox,
)
```

**Define an agent with tool approval (TypeScript)**
```typescript
import { defineAgent, defineTool, sandboxTools } from "@polos/sdk";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const sandbox = sandboxTools({
  env: "docker",
  docker: { image: "node:20-slim", memory: "2g" },
  exec: {
    security: "allowlist",
    allowlist: ["node *", "npm install *", "cat *", "ls *"],
    // Commands matching the allowlist run automatically.
    // Everything else pauses and asks a human to approve.
  },
});

// Bring your own tools - approval: "always" pauses for human approval before every call.
const deployTool = defineTool(
  {
    id: "deploy",
    description: "Deploy the project to production",
    inputSchema: z.object({ env: z.enum(["staging", "production"]), version: z.string() }),
    approval: "always",
  },
  async (ctx, input) => {
    // This only runs after a human approves
    return await pushToCloudDeploy(input.env, input.version);
  }
);

const codingAgent = defineAgent({
  id: "coding_agent",
  model: anthropic("claude-sonnet-4-5"),
  systemPrompt: "You are a coding agent.",
  tools: [...sandbox, deployTool], // sandbox tools + your own
});
```

No DAGs. No graph syntax. Just Python or TypeScript.

---

## See It In Action

Watch a coding agent built with Polos - sandboxed execution, tool approvals, and real-time observability.

[Watch the demo video](https://www.veed.io/embed/7491f507-2b84-4954-b8b1-4ffa69322a91)

---

## Architecture

<p align="center">
  <img src=".github/assets/architecture.png" alt="Polos Architecture" width="800">
</p>

- **Orchestrator**: Written in Rust. Manages execution state, durable logs, retries, scheduling, triggers, and the dashboard UI. Backed by Postgres.
- **Worker**: Runs your agents and workflows, written with the Python or TypeScript SDK. Connects to the orchestrator. Scale horizontally by running multiple workers.

---

## Under the Hood

Polos captures the result of every side effect - tool calls, API responses, time delays - as a durable log. If your process dies, Polos replays the workflow from the log, returning previously-recorded results instead of re-executing them. Your agent's exact local variables and call stack are restored in milliseconds.

**Completed steps are never re-executed - so you never pay for an LLM call twice.**

---

## Featured Examples

| Example | Python | TypeScript | What it shows |
|---------|--------|------------|---------------|
| Sandbox Tools | [Python](./python-examples/18-sandbox-tools) | [TypeScript](./typescript-examples/18-sandbox-tools) | Code execution in an isolated Docker container |
| Order Processing | [Python](./python-examples/17-order-processing) | [TypeScript](./typescript-examples/17-order-processing) | Human-in-the-loop fraud review with approvals |
| Multi-Agent Coordination | [Python](./python-examples/14-router-coordinator) | [TypeScript](./typescript-examples/14-router-coordinator) | Workflow orchestrating multiple specialized agents |
| Event-Triggered | [Python](./python-examples/15-event-triggered) | [TypeScript](./typescript-examples/15-event-triggered) | Pub/sub event-driven workflows |
| Scheduled Workflows | [Python](./python-examples/16-scheduled-workflow) | [TypeScript](./typescript-examples/16-scheduled-workflow) | Cron-based scheduling |

**[Browse all examples →](https://polos.dev/docs/examples)** - agents, workflows, streaming, guardrails, parallel execution, and more.

---

## Documentation

For detailed documentation, visit **[polos.dev/docs](https://polos.dev/docs)**

- 📖 [Quick Start Guide](https://polos.dev/docs/quickstart)
- 🤖 [Building Agents](https://polos.dev/docs/agents/overview)
- ⚙️ [Workflow Patterns](https://polos.dev/docs/workflows/overview)
- 📡 [Events](https://polos.dev/docs/workflows/event-triggered-workflows)
- ⏰ [Scheduling](https://polos.dev/docs/workflows/scheduled-workflows)
- 🔍 [Observability](https://polos.dev/docs/observability/tracing)

---

## Community

Join our community to get help, share ideas, and stay updated:

- ⭐ [Star us on GitHub](https://github.com/polos-dev/polos)
- 💬 [Join our Discord](https://discord.gg/ZAxHKMPwFG)
- 📖 [Read the Docs](https://polos.dev/docs)

---

## Contributing

We welcome contributions! Whether it's bug reports, feature requests, documentation improvements, or code contributions.

- 🐛 [Report Issues](https://github.com/polos-dev/polos/issues)
- 💡 [Feature Requests](https://github.com/polos-dev/polos/issues)
- 📖 [Contributing Guide](CONTRIBUTING.md)

---

## License

Polos is [Apache 2.0 licensed](LICENSE).
