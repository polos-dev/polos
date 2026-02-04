"""Tools for the conversational chat agent."""

from datetime import datetime

from pydantic import BaseModel
from polos import tool, WorkflowContext


class TimeInput(BaseModel):
    """Input for time tool (no parameters needed)."""

    timezone: str = "UTC"


class TimeOutput(BaseModel):
    """Output for time tool."""

    time: str
    timezone: str


@tool(description="Get the current time")
async def get_current_time(ctx: WorkflowContext, input: TimeInput) -> TimeOutput:
    """Get the current time in the specified timezone."""
    now = datetime.now()
    return TimeOutput(
        time=now.strftime("%I:%M %p"),
        timezone=input.timezone,
    )


class WeatherInput(BaseModel):
    """Input for weather tool."""

    city: str


class WeatherOutput(BaseModel):
    """Output for weather tool."""

    city: str
    temperature: int
    condition: str
    unit: str


WEATHER_DATA = {
    "new york": {"temperature": 72, "condition": "Partly Cloudy", "unit": "F"},
    "san francisco": {"temperature": 68, "condition": "Foggy", "unit": "F"},
    "london": {"temperature": 15, "condition": "Rainy", "unit": "C"},
    "tokyo": {"temperature": 22, "condition": "Sunny", "unit": "C"},
    "paris": {"temperature": 18, "condition": "Cloudy", "unit": "C"},
}


@tool(description="Get current weather for a city")
async def get_weather(ctx: WorkflowContext, input: WeatherInput) -> WeatherOutput:
    """Get weather information for a city."""
    city_lower = input.city.lower()
    weather = WEATHER_DATA.get(city_lower, {"temperature": 20, "condition": "Unknown", "unit": "C"})

    return WeatherOutput(
        city=input.city,
        temperature=weather["temperature"],
        condition=weather["condition"],
        unit=weather["unit"],
    )


class CalculatorInput(BaseModel):
    """Input for calculator tool."""

    expression: str


class CalculatorOutput(BaseModel):
    """Output for calculator tool."""

    expression: str
    result: float
    error: str | None = None


@tool(description="Evaluate a mathematical expression")
async def calculator(ctx: WorkflowContext, input: CalculatorInput) -> CalculatorOutput:
    """Safely evaluate a mathematical expression."""
    try:
        # Only allow safe math operations
        allowed_chars = set("0123456789+-*/.() ")
        if not all(c in allowed_chars for c in input.expression):
            return CalculatorOutput(
                expression=input.expression,
                result=0,
                error="Invalid characters in expression",
            )

        result = eval(input.expression)  # Safe because we validated characters
        return CalculatorOutput(
            expression=input.expression,
            result=float(result),
        )
    except Exception as e:
        return CalculatorOutput(
            expression=input.expression,
            result=0,
            error=str(e),
        )
