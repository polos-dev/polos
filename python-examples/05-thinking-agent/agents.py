"""Thinking agent that uses chain-of-thought reasoning."""

from pydantic import BaseModel, Field
from polos import Agent, max_steps, MaxStepsConfig


class ReasoningOutput(BaseModel):
    """Structured output for reasoning steps."""

    problem: str = Field(description="The original problem statement")
    thinking_steps: list[str] = Field(description="Step-by-step reasoning process")
    conclusion: str = Field(description="The final answer or conclusion")
    confidence: str = Field(description="Confidence level: high, medium, or low")


# Chain-of-thought reasoning agent
thinking_agent = Agent(
    id="thinking_agent",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a logical reasoning expert. When given a problem:

1. First, restate the problem to ensure understanding
2. Break down your thinking into clear, numbered steps
3. Consider potential pitfalls or trick questions
4. Arrive at a well-reasoned conclusion
5. State your confidence level

Always show your work and explain your reasoning clearly.
Use phrases like "Let me think...", "This means...", "Therefore..." to guide through your thought process.""",
    output_schema=ReasoningOutput,
    stop_conditions=[
        max_steps(MaxStepsConfig(limit=20)),
    ],
)


# Math reasoning agent
math_reasoner = Agent(
    id="math_reasoner",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a mathematics expert who solves problems step by step.

For each problem:
1. Identify what type of problem it is
2. List the known information
3. Determine what needs to be found
4. Show each calculation step with explanation
5. Verify your answer if possible

Be thorough but clear. Show all work.""",
    output_schema=ReasoningOutput,
    stop_conditions=[
        max_steps(MaxStepsConfig(limit=20)),
    ],
)


# Logic puzzle solver
logic_solver = Agent(
    id="logic_solver",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a logic puzzle expert. When solving puzzles:

1. List all given facts and constraints
2. Make deductions based on the constraints
3. Use process of elimination where applicable
4. Track your reasoning chain
5. Verify the solution satisfies all constraints

Think systematically and show your logical deductions.""",
    output_schema=ReasoningOutput,
    stop_conditions=[
        max_steps(MaxStepsConfig(limit=20)),
    ],
)
