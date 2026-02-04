"""Example tools for agents."""

from pydantic import BaseModel
from polos import tool, WorkflowContext


# Pre-canned weather data for various cities
WEATHER_DATA = {
    "new york": {
        "city": "New York",
        "temperature": 72,
        "condition": "Partly Cloudy",
        "humidity": 65,
        "wind_speed": 10,
        "unit": "F",
    },
    "san francisco": {
        "city": "San Francisco",
        "temperature": 68,
        "condition": "Foggy",
        "humidity": 80,
        "wind_speed": 8,
        "unit": "F",
    },
    "london": {
        "city": "London",
        "temperature": 15,
        "condition": "Rainy",
        "humidity": 85,
        "wind_speed": 12,
        "unit": "C",
    },
    "tokyo": {
        "city": "Tokyo",
        "temperature": 22,
        "condition": "Sunny",
        "humidity": 60,
        "wind_speed": 5,
        "unit": "C",
    },
    "paris": {
        "city": "Paris",
        "temperature": 18,
        "condition": "Cloudy",
        "humidity": 70,
        "wind_speed": 9,
        "unit": "C",
    },
}


class WeatherInput(BaseModel):
    """Input schema for weather tool."""

    city: str


class WeatherOutput(BaseModel):
    """Output schema for weather tool."""

    city: str
    temperature: int
    condition: str
    humidity: int
    wind_speed: int
    unit: str
    error: str | None = None


@tool(description="Get the current weather information for a given city")
async def get_weather(ctx: WorkflowContext, input: WeatherInput) -> WeatherOutput:
    """
    Tool that returns weather information for a city.

    This is a simple example tool that the agent can call.
    In a real scenario, this would query a weather API.
    """
    city = input.city.strip().lower()
    weather = WEATHER_DATA.get(city)

    if not weather:
        # Try to find a partial match
        for key, value in WEATHER_DATA.items():
            if city in key or key in city:
                weather = value
                break

    if not weather:
        return WeatherOutput(
            city=city.title(),
            temperature=0,
            condition="Unknown",
            humidity=0,
            wind_speed=0,
            unit="C",
            error=f"Weather data not available for '{city}'.",
        )

    return WeatherOutput(
        city=weather["city"],
        temperature=weather["temperature"],
        condition=weather["condition"],
        humidity=weather["humidity"],
        wind_speed=weather["wind_speed"],
        unit=weather["unit"],
        error=None,
    )
