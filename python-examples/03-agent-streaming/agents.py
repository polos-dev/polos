"""Agents for the streaming example."""

from polos import Agent, max_steps, MaxStepsConfig


# Storyteller agent - good for demonstrating streaming with longer outputs
storyteller = Agent(
    id="storyteller",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt="""You are a creative storyteller. When asked for a story,
tell an engaging, vivid story with descriptions and dialogue.
Keep stories between 200-400 words unless asked for a different length.""",
    stop_conditions=[
        max_steps(MaxStepsConfig(count=5)),
    ],
)
