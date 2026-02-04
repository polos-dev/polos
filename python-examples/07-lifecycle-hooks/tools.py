"""Example tools for the lifecycle hooks demo."""

from pydantic import BaseModel
from polos import tool, WorkflowContext


class SearchInput(BaseModel):
    """Input for search tool."""

    query: str


class SearchResult(BaseModel):
    """Output from search tool."""

    results: list[str]
    total_count: int


@tool(description="Search for information on a topic")
async def search(ctx: WorkflowContext, input: SearchInput) -> SearchResult:
    """Simulated search tool for demo purposes."""
    # Simulate search results based on query
    query = input.query.lower()

    results = [
        f"Result 1 for '{input.query}'",
        f"Result 2 for '{input.query}'",
        f"Result 3 for '{input.query}'",
    ]

    return SearchResult(results=results, total_count=len(results))


class CalculatorInput(BaseModel):
    """Input for calculator tool."""

    expression: str


class CalculatorOutput(BaseModel):
    """Output from calculator tool."""

    result: float | None
    error: str | None = None


@tool(description="Calculate a mathematical expression")
async def calculate(ctx: WorkflowContext, input: CalculatorInput) -> CalculatorOutput:
    """Simple calculator tool for demo purposes."""
    try:
        # Only allow safe math operations
        allowed_chars = set("0123456789+-*/().% ")
        if not all(c in allowed_chars for c in input.expression):
            return CalculatorOutput(result=None, error="Invalid characters in expression")

        result = eval(input.expression)  # noqa: S307 - Safe due to character whitelist
        return CalculatorOutput(result=float(result))
    except Exception as e:
        return CalculatorOutput(result=None, error=str(e))
