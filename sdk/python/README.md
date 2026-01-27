# Polos Python SDK

Durable execution engine for Python. Build reliable AI agents and workflows that can survive failures, handle long-running tasks, and coordinate complex processes.

## Features

- 🤖 **AI Agents** - Build LLM-powered agents with tool calling, streaming, and conversation history
- 🔄 **Durable Workflows** - Workflows survive failures and resume from checkpoints
- ⏰ **Long-Running** - Execute workflows that run for hours or days
- 🔗 **Workflow Orchestration** - Chain workflows together and build complex processes
- 🛠️ **Tools** - Define reusable tools that agents can call
- 🐍 **Native Python** - Async/await support, type hints, and Pythonic APIs
- 📊 **Observability** - Built-in tracing, events, and monitoring
- 🔒 **Isolated Execution** - Each workflow runs in a secure environment

## Installation

```bash
pip install polos-worker
```

Or with UV (recommended):
```bash
uv add polos-worker
```

### Optional Dependencies

Install provider-specific dependencies for LLM support:

```bash
# OpenAI
pip install polos-worker[openai]

# Anthropic
pip install polos-worker[anthropic]

# Google Gemini
pip install polos-worker[gemini]

# Groq
pip install polos-worker[groq]

# Fireworks
pip install polos-worker[fireworks]

# Together AI
pip install polos-worker[together]

# All providers
pip install polos-worker[openai,anthropic,gemini,groq,fireworks,together]
```

## Quick Start

### 1. Configure the SDK

```python
from polos import configure

configure(
    api_url='http://localhost:8080',
    api_key='your-api-key',  # Optional if running in dev mode
    project_id='your-project-id'
)
```

Or use environment variables:
```bash
export POLOS_API_URL=http://localhost:8080
export POLOS_API_KEY=your-api-key
export POLOS_PROJECT_ID=your-project-id
```

### 2. Define a Workflow

```python
from polos import workflow, WorkflowContext

@workflow(id="hello_world")
async def hello_world(ctx: WorkflowContext, payload: dict):
    """A simple workflow."""
    name = payload.get('name', 'World')
    return {'message': f'Hello, {name}!'}
```

### 3. Create an Agent

```python
from polos import Agent

weather_agent = Agent(
    id="weather-agent",
    provider="openai",
    model="gpt-5-mini",
    system_prompt="You are a helpful weather assistant",
    tools=[get_weather]  # Your custom tools
)
```

### 4. Run Your Code

Start a worker to execute workflows and agents:

```bash
# Using the Python worker
python -m polos.runtime.worker

# Or use the Node.js worker (supports Python workflows)
npm install -g polos-worker
polos-worker start
```

## Core Concepts

### Workflows

Workflows are durable functions that can survive failures and resume execution:

```python
from polos import workflow, WorkflowContext, WorkflowState

class MyState(WorkflowState):
    counter: int = 0
    messages: list[str] = []

@workflow(id="my_workflow", state_schema=MyState)
async def my_workflow(ctx: WorkflowContext, payload: dict):
    # Access state
    ctx.state.counter += 1
    ctx.state.messages.append(payload.get('message', ''))
    
    # Use step.run() for durable execution
    result = await ctx.step.run("process_data", process_data, payload)
    
    return {'result': result, 'counter': ctx.state.counter}
```

### Agents

Agents are LLM-powered workflows with tool calling capabilities:

```python
from polos import Agent, max_steps, executed_tool

# Define a tool
from polos import tool

@tool
def get_weather(ctx, location: str) -> str:
    """Get weather for a location."""
    # Your weather API call here
    return f"Weather in {location}: 72°F, sunny"

# Create an agent
weather_agent = Agent(
    id="weather-agent",
    provider="openai",
    model="gpt-5-mini",
    system_prompt="You are a helpful weather assistant",
    tools=[get_weather],
    stop_conditions=[max_steps(10), executed_tool("get_weather")]
)

# Use the agent
result = await weather_agent.run("What's the weather in NYC?")
print(result.result)  # Agent's response

# Or stream the response
stream_result = await weather_agent.stream("What's the weather in NYC?")
async for event in stream_result.events:
    if event.event_type == "text_delta":
        print(event.data.get("content", ""), end="", flush=True)
```

### Tools

Tools are functions that agents can call:

```python
from polos import tool, WorkflowContext

@tool
def calculate(ctx: WorkflowContext, expression: str) -> float:
    """Evaluate a mathematical expression."""
    return eval(expression)  # In production, use a safe evaluator

@tool
def search_web(ctx: WorkflowContext, query: str) -> str:
    """Search the web for information."""
    # Your search implementation
    return f"Results for: {query}"
```

### Hooks

Hooks allow you to intercept workflow execution:

```python
from polos import hook, HookContext, HookResult, HookAction

@hook
def log_execution(ctx: WorkflowContext, hook_ctx: HookContext) -> HookResult:
    """Log workflow execution."""
    print(f"Workflow {ctx.workflow_id} started")
    return HookResult.continue_with()

@workflow(id="my_workflow", on_start=log_execution)
async def my_workflow(ctx: WorkflowContext, payload: dict):
    return {'result': 'done'}
```

### Guardrails

Guardrails validate and modify agent outputs:

```python
from polos import guardrail, GuardrailContext, GuardrailResult

@guardrail
def check_profanity(ctx: GuardrailContext) -> GuardrailResult:
    """Check for profanity in agent output."""
    content = ctx.content or ""
    if any(word in content.lower() for word in ["bad", "word"]):
        return GuardrailResult.fail("Content contains inappropriate language")
    return GuardrailResult.continue_with()

weather_agent = Agent(
    id="weather-agent",
    provider="openai",
    model="gpt-5-mini",
    guardrails=[check_profanity]
)
```

## Advanced Features

### State Management

Workflows can maintain state across executions:

```python
from polos import workflow, WorkflowContext, WorkflowState

class CounterState(WorkflowState):
    count: int = 0
    history: list[str] = []

@workflow(id="counter", state_schema=CounterState)
async def counter(ctx: WorkflowContext, payload: dict):
    ctx.state.count += 1
    ctx.state.history.append(payload.get('action', ''))
    return {'count': ctx.state.count}
```

### Step Execution

Use `ctx.step` for durable execution:

```python
@workflow(id="my_workflow")
async def my_workflow(ctx: WorkflowContext, payload: dict):
    # Run a step (durable)
    result = await ctx.step.run("step_name", my_function, arg1, arg2)
    
    # Invoke another workflow and wait
    result = await ctx.step.invoke_and_wait("other_workflow", other_workflow, payload)
    
    # Invoke another workflow (fire and forget)
    handle = await ctx.step.invoke("other_workflow", other_workflow, payload)
    
    # Wait for a workflow to complete
    result = await ctx.step.wait_for(handle)
    
    return result
```

### Events

Publish and subscribe to events:

```python
from polos import events

# Publish an event
await events.publish(
    topic="user/123",
    event_type="message",
    data={"text": "Hello"}
)

# Stream events
async for event in events.stream_topic("user/123"):
    print(f"Event: {event.event_type} - {event.data}")
```

### Scheduled Workflows

Schedule workflows to run on a schedule:

```python
@workflow(
    id="daily_report",
    schedule="0 9 * * *"  # 9 AM daily
)
async def daily_report(ctx: WorkflowContext, payload: dict):
    # Generate daily report
    return {'report': '...'}
```

### Queues

Use queues for concurrency control:

```python
from polos import Queue

my_queue = Queue(name="processing", concurrency_limit=5)

@workflow(id="processor", queue=my_queue)
async def processor(ctx: WorkflowContext, payload: dict):
    # Process item
    return {'status': 'processed'}
```

### Batch Execution

Execute workflows in batch:

```python
from polos import batch

results = await batch.run(
    workflow_id="my_workflow",
    inputs=[
        {"value": 1},
        {"value": 2},
        {"value": 3}
    ]
)

for result in results:
    print(result.result)
```

## Testing

The SDK includes comprehensive unit tests. Run tests with:

```bash
# Install test dependencies
uv sync --dev

# Run all tests
uv run pytest

# Run with coverage
uv run pytest --cov=polos --cov-report=html

# Run specific test file
uv run pytest tests/unit/test_core/test_workflow.py
```

See [`TESTING_PLAN.md`](./TESTING_PLAN.md) for testing guidelines.

## Development Setup

### Using UV (Recommended)

```bash
# Fork the repository on GitHub first: https://github.com/polos-dev/polos
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/polos.git
cd polos/sdk/python

# Install dependencies (creates venv automatically)
uv sync

# Format code with Ruff
uv run ruff format .

# Lint code
uv run ruff check .

# Run tests
uv run pytest

# Build package
uv build
```

### Using pip

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install in development mode
pip install -e ".[dev]"

# Format code
ruff format .

# Lint code
ruff check .

# Run tests
pytest
```

### Pre-commit Hooks

The project uses pre-commit hooks for code quality:

```bash
# Install pre-commit
pip install pre-commit

# Install hooks
pre-commit install

# Run hooks manually
pre-commit run --all-files
```

## Project Structure

```
sdk/python/
├── polos/                  # Main package
│   ├── agents/             # Agent implementation
│   ├── core/               # Core workflow/step/context
│   ├── features/           # Events, schedules, tracing
│   ├── llm/                # LLM providers
│   ├── middleware/         # Hooks and guardrails
│   ├── runtime/            # Worker and client
│   ├── tools/              # Tool implementation
│   ├── types/              # Type definitions
│   └── utils/              # Utility functions
├── tests/                  # Test suite
│   └── unit/               # Unit tests
├── pyproject.toml          # Project configuration
└── README.md               # This file
```

## API Reference

### Core Functions

#### `@workflow(id, queue, schedule, state_schema, ...)`

Decorator to register a workflow function.

**Parameters:**
- `id` (str): Unique workflow identifier
- `queue` (str | Queue | dict, optional): Queue configuration
- `schedule` (str | dict, optional): Cron schedule or schedule config
- `state_schema` (type[WorkflowState], optional): State schema class
- `on_start` (Callable | list, optional): Hooks to run on start
- `on_end` (Callable | list, optional): Hooks to run on end

**Example:**
```python
@workflow(id="my_workflow", state_schema=MyState)
async def my_workflow(ctx: WorkflowContext, payload: dict):
    return {'result': 'done'}
```

#### `Agent(id, provider, model, ...)`

Create an AI agent.

**Parameters:**
- `id` (str): Unique agent identifier
- `provider` (str): LLM provider ("openai", "anthropic", etc.)
- `model` (str): Model name (e.g., "gpt-4o", "claude-sonnet-4-5")
- `system_prompt` (str, optional): System prompt
- `tools` (list, optional): List of tools
- `stop_conditions` (list, optional): Stop condition callables
- `guardrails` (list, optional): Guardrail callables

**Example:**
```python
agent = Agent(
    id="my-agent",
    provider="openai",
    model="gpt-5-mini",
    tools=[my_tool]
)
```

#### `@tool`

Decorator to register a tool function.

**Example:**
```python
@tool
def my_tool(ctx: WorkflowContext, arg: str) -> str:
    return f"Processed: {arg}"
```

### Context Objects

#### `WorkflowContext`

Context object passed to workflow functions.

**Properties:**
- `workflow_id` (str): Workflow identifier
- `execution_id` (str): Current execution ID
- `root_execution_id` (str): Root execution ID
- `state` (WorkflowState): Workflow state
- `step` (Step): Step helper for durable execution

#### `AgentContext`

Context object passed to agent functions (extends `WorkflowContext`).

**Additional Properties:**
- `agent_id` (str): Agent identifier
- `conversation_id` (str, optional): Conversation ID for history

## Environment Variables

- `POLOS_API_URL` - Orchestrator URL (default: `http://localhost:8080`)
- `POLOS_API_KEY` - API key for authentication
- `POLOS_PROJECT_ID` - Project ID for multi-project support

## Architecture

Polos uses a push-based worker architecture:

```
┌─────────────┐
│   Client    │ ── trigger ──> ┌──────────────┐
└─────────────┘                │ Orchestrator │
                               │  (Rust API)  │
                               └──────────────┘
                                      │
                                   invokes
                                      ↓
┌─────────────┐              ┌──────────────┐
│  Executor   │ <── pushes ──│    Worker    │
│  (Python)   │              │   (Python)   │
└─────────────┘              └──────────────┘
```

1. **Client** triggers workflow/agent via SDK
2. **Orchestrator** queues execution in database
3. **Orchestrator** pushes execution to worker via HTTP
4. **Worker** receives execution request and executes workflow/agent in process
5. **Worker** reports result back to orchestrator
6. **Orchestrator** marks execution complete
7. **Client** receives result

## Contributing

We welcome contributions! See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

### Development Workflow

1. **Fork the repository** on GitHub: https://github.com/polos-dev/polos
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/polos.git
   cd polos/sdk/python
   ```
3. **Add upstream remote** (optional, for syncing with main repo):
   ```bash
   git remote add upstream https://github.com/polos-dev/polos.git
   ```
4. Create a feature branch
5. Make your changes
6. Run tests: `uv run pytest`
7. Format code: `uv run ruff format .`
8. Lint code: `uv run ruff check .`
9. Submit a pull request to `polos-dev/polos`

## License

MIT License - see [LICENSE](../../LICENSE) for details.

## Support

- 📖 [Documentation](https://docs.polos.dev)
- 💬 [Discord Community](https://discord.gg/polos)
- 🐛 [Issue Tracker](https://github.com/polos-dev/polos/issues)
- 📧 [Email Support](mailto:support@polos.dev)

## Related Projects

- [Polos Orchestrator](../../orchestrator) - Rust-based orchestrator
- [Polos UI](../../ui) - Web interface for monitoring and management

---

Built with ❤️ by the Polos team
