<p align="center">
  <img src=".github/assets/logo.png" alt="Polos Logo" width="200">
</p>

<p align="center">
  <strong>The runtime for agents that do real work</strong>
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
  Sandboxed execution. Agents that reach you. Durable workflows.
</p>

<p align="center">
  <b>⭐ Star us to support the project!</b>
</p>

---

AI agents break the rules of traditional software. They're **async by nature** - running while you sleep, but still needing you to approve, confirm, or provide a credential. They're **autonomous by design** - you say "fix the bug" and they write code, run commands, delete files. That power is the point. And the risk.

Most frameworks ignore this. Polos is built for it.

100% open source. Write it all in plain Python or TypeScript. No DAGs to define, no graph syntax to learn.

```typescript
import { defineAgent, sandboxTools } from "@polos/sdk";
import { anthropic } from "@ai-sdk/anthropic";

// Create a sandboxed environment — agents get exec, read, write,
// edit, glob, and grep tools automatically.
const sandbox = sandboxTools({
  env: 'docker',
  docker: {
    image: 'node:20-slim',
    workspaceDir: './workspace',
    memory: '2g',
  },
});

// Give the agent sandbox tools — it can now run commands,
// read/write files, and explore the codebase autonomously.
const codingAgent = defineAgent({
  id: 'coding_agent',
  model: anthropic('claude-opus-4-5'),
  systemPrompt: 'You are a coding assistant. The repo is at /workspace.',
  tools: [...sandbox], // exec, read, write, edit, glob, grep
});
```

---

## What You Get With Polos

### Secure Sandbox

Agents run in isolated environments - Docker, E2B, or cloud VMs. Built-in tools for shell, file system, and web search. Full power. Zero risk to your systems.

### Agents That Reach You

Agents reach you - not the other way around. Stripe-like approval pages that collect input, not just yes/no. Slack, SMS, email - you're at dinner, phone buzzes, one tap, done.

### Durable Execution

State persists - agents resume exactly where they left off. Automatic retries on failure. 60-80% cost savings via prompt caching. Built-in observability for every step, every approval, every tool call. Concurrency control across multiple agents - no API rate limit chaos.

---

## See It In Action

Watch a coding agent built with Polos - sandboxed execution, tool calls, and real-time observability.

[Watch the demo video](https://www.veed.io/embed/7491f507-2b84-4954-b8b1-4ffa69322a91)

---

## Quick Start

### 1. Install Polos Server

```bash
curl -fsSL https://install.polos.dev/install.sh | bash
polos server start
```

Copy the project ID displayed when you start the server. You'll need it in the next steps.

### 2. Install the SDK

**Python**
```bash
pip install polos-sdk
```

**TypeScript**
```bash
npm install @polos/sdk
```

### 3. Create a coding agent

**Python**
```python
# agents.py
from polos import Agent, sandbox_tools, SandboxToolsConfig, LocalEnvironmentConfig

sandbox_tools = sandbox_tools(SandboxToolsConfig(
    env="local",
    local=LocalEnvironmentConfig(cwd="./workspace", path_restriction="./workspace"),
))

coding_agent = Agent(
    id="coding_agent",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt="You are a coding agent. Your workspace is at ./workspace.",
    tools=sandbox_tools,
)
```

```python
# worker.py
from polos import PolosClient, Worker
from agents import coding_agent, sandbox_tools

client = PolosClient(project_id="your-project-id")
worker = Worker(client=client, agents=[coding_agent], tools=list(sandbox_tools))

if __name__ == "__main__":
    import asyncio
    asyncio.run(worker.run())
```

**TypeScript**
```typescript
// agents.ts
import { defineAgent, sandboxTools } from "@polos/sdk";
import { anthropic } from "@ai-sdk/anthropic";

export const sandboxTools = sandboxTools({
  env: "local",
  local: { cwd: "./workspace", pathRestriction: "./workspace" },
});

export const codingAgent = defineAgent({
  id: "coding_agent",
  model: anthropic("claude-sonnet-4-5"),
  systemPrompt: "You are a coding agent. Your workspace is at ./workspace.",
  tools: [...sandboxTools],
});
```

```typescript
// worker.ts
import { PolosClient, Worker } from "@polos/sdk";
import { codingAgent, sandboxTools } from "./agents.js";

const client = new PolosClient({ projectId: "your-project-id" });
const worker = new Worker({ client, agents: [codingAgent], tools: [...sandboxTools] });

await worker.run();
```

### 4. Invoke the agent

Local sandbox tools suspend for approval before running commands or writing files. The client streams workflow events, prompts you in the terminal, and resumes the agent.

**Python**
```python
# main.py
import asyncio
from polos import PolosClient
from polos.features import events
from agents import coding_agent

async def main():
    client = PolosClient(project_id="your-project-id")
    handle = await client.invoke(coding_agent.id, {
        "input": "Create hello.js that prints 'Hello, world!' and run it.",
        "streaming": True,
    })

    # Stream events — approve each exec/write/edit when the agent suspends
    async for event in events.stream_workflow(client, handle.root_workflow_id, handle.id):
        if event.event_type and event.event_type.startswith("suspend_"):
            step_key = event.event_type[len("suspend_"):]
            form = event.data.get("_form", {})
            context = form.get("context", {})
            print(f"\n  Agent wants to: {context.get('command') or context.get('tool', step_key)}")
            approved = input("  Approve? (y/n): ").strip().lower() == "y"
            await client.resume(handle.root_workflow_id, handle.id, step_key, {"approved": approved})

    execution = await client.get_execution(handle.id)
    print(f"\nResult: {execution.get('result')}")

asyncio.run(main())
```

**TypeScript**
```typescript
// main.ts
import { PolosClient } from "@polos/sdk";
import { codingAgent } from "./agents.js";
import * as readline from "node:readline/promises";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const client = new PolosClient({ projectId: "your-project-id" });
const handle = await client.invoke(codingAgent.id, {
  input: "Create hello.js that prints 'Hello, world!' and run it.",
  streaming: true,
});

// Stream events — approve each exec/write/edit when the agent suspends
for await (const event of client.events.streamWorkflow(handle.rootWorkflowId, handle.id)) {
  if (event.eventType?.startsWith("suspend_")) {
    const stepKey = event.eventType.slice("suspend_".length);
    const context = (event.data as any)?._form?.context ?? {};
    console.log(`\n  Agent wants to: ${context.command ?? context.tool ?? stepKey}`);
    const answer = await rl.question("  Approve? (y/n): ");
    const approved = answer.trim().toLowerCase() === "y";
    await client.resume(handle.rootWorkflowId, handle.id, stepKey, { approved });
  }
}

const execution = await client.getExecution(handle.id);
console.log(`\nResult: ${typeof execution.result === "string" ? execution.result : JSON.stringify(execution.result)}`);
rl.close();
```

### 5. Run it

```bash
# Terminal 1: Start the worker
python worker.py    # or: npx tsx worker.ts

# Terminal 2: Invoke the agent
python main.py      # or: npx tsx main.ts
```

See the full example for [Python](./python-examples/21-local-sandbox) or [TypeScript](./typescript-examples/21-local-sandbox) with richer approval UIs and more.

### 6. See it in action

Open the Polos UI to see your agent's execution trace, tool calls, and reasoning:

<p align="center">
  <img src=".github/assets/observability.png" alt="Polos Observability UI" width="800">
</p>

📖 **[Full Quick Start Guide →](https://polos.dev/docs/quickstart)**

---

## Architecture

<p align="center">
  <img src=".github/assets/architecture.png" alt="Polos Architecture" width="800">
</p>

Polos consists of three components:

- **Orchestrator**: Written in Rust. Manages execution state, handles retries, and coordinates workers
- **Worker**: Runs your agents and workflows, connects to the orchestrator
- **SDK**: Python and TypeScript libraries for defining agents, workflows, and tools

---

## Why Polos?

| Feature | Description |
|---------|-------------|
| **🔒 Sandboxed Execution** | Agents run in isolated Docker containers, E2B, or cloud VMs. Built-in tools for shell, files, and web search - full autonomy with zero risk. |
| **📲 Agents That Reach You** | Approval pages, Slack, SMS, email. Agents notify you when they need input. One tap from your phone. Done. |
| **🧠 Durable State** | Your agent survives crashes with call stack and local variables intact. Step 18 of 20 fails? Resume from step 18. No wasted LLM calls. |
| **🚦 Global Concurrency** | System-wide rate limiting with queues and concurrency keys. Prevent one rogue agent from exhausting your entire OpenAI quota. |
| **🤝 Human-in-the-Loop** | Native support for pausing execution. Wait hours or days for user approval and resume with full context. Paused agents consume zero compute. |
| **📡 Agent Handoffs** | Transactional memory for multi-agent systems. Pass reasoning history between specialized agents without context drift. |
| **🔍 Decision-Level Observability** | Trace the reasoning behind every tool call, not just raw logs. See why your agent chose Tool B over Tool A. |
| **⚡ Production Ready** | Automatic retries, exactly-once execution guarantees, OpenTelemetry tracing built-in. |

<br />

### Logic Belongs in Code, Not Configs

**With Polos:**

**Python**
```python
@workflow
async def process_order(ctx: WorkflowContext, order: ProcessOrderInput):
    if order.amount > 1000:
        approved = await ctx.step.suspend("approval", data=order.model_dump())
        if not approved.data["ok"]:
            return {"status": "rejected"}

    await ctx.step.run("charge", charge_stripe, order)
    await ctx.step.run("notify", send_email, order)
```

**TypeScript**
```typescript
const processOrder = defineWorkflow({ id: "process-order" }, async (ctx, order) => {
  if (order.amount > 1000) {
    const approved = await ctx.step.suspend("approval", { data: order });
    if (!approved.data.ok) {
      return { status: "rejected" };
    }
  }

  await ctx.step.run("charge", () => chargeStripe(order));
  await ctx.step.run("notify", () => sendEmail(order));
});
```

**Other platforms:**
```python
dag = DAG(
    nodes=[
        Node("check_amount", CheckAmount),
        Node("approval", HumanApproval),
        Node("charge", ChargeStripe),
        Node("notify", SendEmail),
    ],
    edges=[
        ("check_amount", "approval", condition="amount > 1000"),
        ("check_amount", "charge", condition="amount <= 1000"),
        ("approval", "charge", condition="approved"),
        ("charge", "notify"),
    ]
)
```

No DAGs. No graph syntax. Just Python or TypeScript.

---

## Examples

### Agents

| Example | Python | TypeScript | Description |
|---------|--------|------------|-------------|
| Agent with tools | [Python](./python-examples/01-agent-with-tools) | [TypeScript](./typescript-examples/01-agent-with-tools) | Simple agent with tool calling |
| Structured Output | [Python](./python-examples/02-structured-output) | [TypeScript](./typescript-examples/02-structured-output) | Agent with structured model responses |
| Streaming | [Python](./python-examples/03-agent-streaming) | [TypeScript](./typescript-examples/03-agent-streaming) | Real-time streaming responses |
| Conversational Chat | [Python](./python-examples/04-conversational-chat) | [TypeScript](./typescript-examples/04-conversational-chat) | Multi-turn conversations with memory |
| Thinking Agent | [Python](./python-examples/05-thinking-agent) | [TypeScript](./typescript-examples/05-thinking-agent) | Chain-of-thought reasoning |
| Guardrails | [Python](./python-examples/06-guardrails) | [TypeScript](./typescript-examples/06-guardrails) | Input/output validation |
| Multi-Agent Coordination | [Python](./python-examples/14-router-coordinator) | [TypeScript](./typescript-examples/14-router-coordinator) | Workflow orchestrating multiple agents |
| Order Processing | [Python](./python-examples/17-order-processing) | [TypeScript](./typescript-examples/17-order-processing) | Human-in-the-loop fraud review |
| Sandbox Tools | [Python](./python-examples/18-sandbox-tools) | [TypeScript](./typescript-examples/18-sandbox-tools) | Code execution in an isolated Docker container |
| Exec Security | [Python](./python-examples/19-exec-security) | [TypeScript](./typescript-examples/19-exec-security) | Allowlist-based command approval |
| Web Search Agent | [Python](./python-examples/20-web-search-agent) | [TypeScript](./typescript-examples/20-web-search-agent) | Research agent with Tavily web search |
| Local Sandbox | [Python](./python-examples/21-local-sandbox) | [TypeScript](./typescript-examples/21-local-sandbox) | Sandbox tools running on the host machine |

### Workflows

| Example | Python | TypeScript | Description |
|---------|--------|------------|-------------|
| Workflow Basics | [Python](./python-examples/08-workflow-basics) | [TypeScript](./typescript-examples/08-workflow-basics) | Core workflow patterns |
| Suspend/Resume | [Python](./python-examples/09-suspend-resume) | [TypeScript](./typescript-examples/09-suspend-resume) | Human-in-the-loop approvals |
| State Persistence | [Python](./python-examples/10-state-persistence) | [TypeScript](./typescript-examples/10-state-persistence) | Durable state across executions |
| Error Handling | [Python](./python-examples/11-error-handling) | [TypeScript](./typescript-examples/11-error-handling) | Retry, fallback, compensation patterns |
| Queues & Concurrency | [Python](./python-examples/12-shared-queues) | [TypeScript](./typescript-examples/12-shared-queues) | Rate limiting and concurrency control |
| Parallel Execution | [Python](./python-examples/13-parallel-review) | [TypeScript](./typescript-examples/13-parallel-review) | Fan-out/fan-in patterns |

### Events & Scheduling

| Example | Python | TypeScript | Description |
|---------|--------|------------|-------------|
| Event-Triggered | [Python](./python-examples/15-event-triggered) | [TypeScript](./typescript-examples/15-event-triggered) | Pub/sub event-driven workflows |
| Scheduled Workflows | [Python](./python-examples/16-scheduled-workflow) | [TypeScript](./typescript-examples/16-scheduled-workflow) | Cron-based scheduling |

### Human-in-the-Loop

| Example | Python | TypeScript | Description |
|---------|--------|------------|-------------|
| Approval Page | [Python](./python-examples/22-approval-page) | [TypeScript](./typescript-examples/22-approval-page) | Web UI for workflow approval with suspend/resume |

---

## Under the Hood

Polos captures the result of every side effect - tool calls, API responses, time delays as a durable log.
If your process dies, Polos replays the workflow from the log, returning previously-recorded results instead of re-executing them.
Your agent's exact local variables and call stack are restored in milliseconds.

**Completed steps are never re-executed - so you never pay for an LLM call twice.**

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
