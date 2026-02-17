"""Conversational chat agent with tools."""

from polos import Agent, max_steps, MaxStepsConfig
from polos.memory.types import CompactionConfig
from tools import get_current_time, get_weather, calculator


# Conversational assistant with tools
chat_assistant = Agent(
    id="chat_assistant",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a friendly and helpful assistant. You can:
- Tell the current time using the get_current_time tool
- Get weather information using the get_weather tool
- Perform calculations using the calculator tool

Be conversational and helpful.
When using tools, briefly explain what you're doing.""",
    tools=[get_current_time, get_weather, calculator],
    stop_conditions=[
        max_steps(MaxStepsConfig(count=10)),
    ],
)
