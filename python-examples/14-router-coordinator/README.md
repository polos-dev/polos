# Router/Coordinator Example

This example demonstrates multi-agent teams with a coordinator pattern.

## Features

- Team coordination with LLM-based routing
- Multiple specialized agents
- Shared tools across team members
- Iterative workflows with review loops

## What are Teams?

Teams coordinate multiple agents, tools, and workflows:

| Component | Role |
|-----------|------|
| Coordinator LLM | Decides which members to invoke |
| Agents | Specialized workers with specific capabilities |
| Tools | Shared utilities available to all members |
| Workflows | Reusable processes |

## Files

- `agents.py` - Specialized agent definitions
- `teams.py` - Team configurations
- `worker.py` - Worker that registers teams

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
   ```

4. Run the worker:
   ```bash
   python worker.py
   ```

## Defining Teams

```python
from polos import Team, Agent, tool

# Define specialized agents
researcher = Agent(
    id="researcher",
    description="Gathers information from the web",
    provider="openai",
    model="gpt-4o-mini",
    tools=[web_search],
)

writer = Agent(
    id="writer",
    description="Creates documentation and content",
    provider="openai",
    model="gpt-4o-mini",
)

# Create a team
research_team = Team(
    id="research_team",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="You are a team coordinator...",
    agents=[researcher, writer],
    tools=[web_search],  # Tools available to coordinator
    max_iterations=10,
)
```

## Team Execution Flow

```
1. User provides a goal
   │
2. Coordinator LLM analyzes the goal
   │
3. Coordinator decides which member(s) to invoke
   │
4. Member executes and returns result
   │
5. Coordinator receives result
   │
6. Coordinator decides: continue or complete?
   │
   ├── Continue → Go to step 3
   │
   └── Complete → Return final result
```

## Member Types

### Agents
```python
researcher = Agent(
    id="researcher",
    description="Gathers and synthesizes information",  # Important!
    provider="openai",
    model="gpt-4o-mini",
    tools=[web_search],
)
```

The `description` field is crucial - it tells the coordinator when to use this agent.

### Tools
```python
@tool(description="Search the web for information")
async def web_search(ctx, query: SearchQuery) -> SearchResult:
    ...
```

Tools are exposed to the coordinator as `tool:<tool_id>`.

### Workflows
```python
@workflow(id="data_pipeline", description="Process data in batches")
async def data_pipeline(ctx, payload):
    ...

team = Team(
    id="my_team",
    workflows=[data_pipeline],
    ...
)
```

## Team Patterns

### Router Pattern
Routes tasks to the most appropriate single agent:

```python
router = Team(
    id="router",
    system_prompt="Delegate to ONE appropriate agent...",
    agents=[agent_a, agent_b, agent_c],
    max_iterations=5,
)
```

### Pipeline Pattern
Processes through agents in sequence:

```python
pipeline = Team(
    id="pipeline",
    system_prompt='''Process in order:
    1. researcher gathers data
    2. analyst processes data
    3. writer creates report''',
    agents=[researcher, analyst, writer],
)
```

### Review Loop Pattern
Iterates until quality is met:

```python
review_loop = Team(
    id="review_loop",
    system_prompt='''Process:
    1. writer creates content
    2. reviewer checks quality
    3. If not approved, writer revises
    4. Repeat until approved''',
    agents=[writer, reviewer],
    max_iterations=10,
)
```

## Best Practices

1. **Clear descriptions** - Help coordinator understand when to use each member
2. **Focused agents** - Each agent should have a specific role
3. **Iteration limits** - Set reasonable `max_iterations` to prevent infinite loops
4. **Explicit instructions** - Coordinator prompt should be clear about process
