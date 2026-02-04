"""Agents with lifecycle hooks attached."""

from polos import Agent, max_steps, MaxStepsConfig

from tools import search, calculate
from hooks import (
    log_start,
    log_end,
    log_step_start,
    log_step_end,
    log_tool_start,
    log_tool_end,
    validate_input,
)


# Agent with full lifecycle logging
logged_agent = Agent(
    id="logged_agent",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a helpful assistant with access to search and calculator tools.
Use these tools to help answer user questions.""",
    tools=[search, calculate],
    # Lifecycle hooks
    on_start=[validate_input, log_start],  # Multiple hooks run in order
    on_end=[log_end],
    on_agent_step_start=[log_step_start],
    on_agent_step_end=[log_step_end],
    on_tool_start=[log_tool_start],
    on_tool_end=[log_tool_end],
    stop_conditions=[
        max_steps(MaxStepsConfig(limit=5)),
    ],
)


# Agent with just start/end logging
simple_logged_agent = Agent(
    id="simple_logged_agent",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a helpful assistant.""",
    on_start=[log_start],
    on_end=[log_end],
    stop_conditions=[
        max_steps(MaxStepsConfig(limit=5)),
    ],
)


# Agent with input validation
validated_agent = Agent(
    id="validated_agent",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a helpful assistant.""",
    on_start=[validate_input],  # Will reject empty or overly long prompts
    stop_conditions=[
        max_steps(MaxStepsConfig(limit=5)),
    ],
)
