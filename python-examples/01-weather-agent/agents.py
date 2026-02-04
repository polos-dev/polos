"""Example workflows and agents for the Hello World example."""

from polos import Agent, max_steps, MaxStepsConfig
from tools import get_weather


# Define a weather agent that can look up weather information
weather_agent = Agent(
    id="weather_agent",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="You are a helpful weather assistant. Use the get_weather tool to look up weather information when asked.",
    tools=[get_weather],
    stop_conditions=[
        max_steps(MaxStepsConfig(limit=10)),
    ],
)
