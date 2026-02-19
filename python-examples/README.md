# Polos Python Examples

Example projects demonstrating how to use the Polos SDK for Python.

Each folder contains an independently executable example with its own `pyproject.toml` and `README.md`.

## Prerequisites

1. **Polos Server** - Install and start the orchestrator:
   ```bash
   curl -fsSL https://install.polos.dev/install.sh | bash
   polos server start
   ```

2. **Python 3.10+**

3. **uv** (recommended) or pip for package management

## Examples

### Agents

| Example | Description |
|---------|-------------|
| [01-agent-with-tools](./01-agent-with-tools) | Simple agent with a weather tool |
| [02-structured-output](./02-structured-output) | Agent with structured output using Pydantic models |
| [03-agent-streaming](./03-agent-streaming) | Streaming agent responses in real-time |
| [04-conversational-chat](./04-conversational-chat) | Multi-turn conversational agent with memory |
| [05-thinking-agent](./05-thinking-agent) | Chain-of-thought reasoning agent |
| [06-guardrails](./06-guardrails) | Input/output validation and content filtering |
| [07-lifecycle-hooks](./07-lifecycle-hooks) | Agent lifecycle hooks (on_start, on_end, on_tool_call) |
| [14-router-coordinator](./14-router-coordinator) | Multi-agent coordination with workflow orchestration |
| [17-order-processing](./17-order-processing) | Order processing with human-in-the-loop fraud review (**used in the README demo**) |
| [18-sandbox-tools](./18-sandbox-tools) | Code execution agent with sandbox tools in Docker |
| [19-exec-security](./19-exec-security) | Exec allowlist security with command approval |
| [20-web-search-agent](./20-web-search-agent) | Research agent with Tavily web search and ask-user |
| [21-local-sandbox](./21-local-sandbox) | Sandbox tools running locally on the host machine |

### Workflows

| Example | Description |
|---------|-------------|
| [08-workflow-basics](./08-workflow-basics) | Basic workflow patterns and step execution |
| [09-suspend-resume](./09-suspend-resume) | Human-in-the-loop workflows with suspend/resume |
| [10-state-persistence](./10-state-persistence) | Durable workflow state across executions |
| [11-error-handling](./11-error-handling) | Retry, fallback, and error recovery patterns |
| [12-shared-queues](./12-shared-queues) | Queue-based concurrency control |
| [13-parallel-review](./13-parallel-review) | Parallel workflow execution and fan-out/fan-in |
| [14-router-coordinator](./14-router-coordinator) | Multi-agent coordination with workflow orchestration |

### Human-in-the-Loop

| Example | Description |
|---------|-------------|
| [22-approval-page](./22-approval-page) | Web UI approval page with suspend/resume |

### Events & Scheduling

| Example | Description |
|---------|-------------|
| [15-event-triggered](./15-event-triggered) | Event-driven workflows with publish/subscribe |
| [16-scheduled-workflow](./16-scheduled-workflow) | Cron-based scheduled workflow execution |

## Quick Start

1. Start the Polos server:
   ```bash
   polos server start
   ```

2. Navigate to an example:
   ```bash
   cd 01-weather-agent
   ```

3. Install dependencies:
   ```bash
   uv sync
   ```

4. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

5. Start the worker (Terminal 1):
   ```bash
   python worker.py
   ```

6. Run the example (Terminal 2):
   ```bash
   python main.py
   ```

## Documentation

For complete documentation, visit [https://docs.polos.dev](https://docs.polos.dev)

Fetch the documentation index: [https://docs.polos.dev/llms.txt](https://docs.polos.dev/llms.txt)
