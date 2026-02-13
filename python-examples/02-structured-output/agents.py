"""Agents with structured output using Pydantic models."""

from polos import Agent, max_steps, MaxStepsConfig
from schemas import MovieReview, RecipeOutput, SentimentAnalysis


# Movie reviewer agent with structured output
movie_reviewer = Agent(
    id="movie_reviewer",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a professional movie critic. When asked to review a movie,
provide a comprehensive review with rating, pros, cons, and recommendation.
Always respond with structured data matching the required format.""",
    output_schema=MovieReview,  # Pydantic model for structured output
    stop_conditions=[
        max_steps(MaxStepsConfig(count=5)),
    ],
)


# Recipe generator agent with structured output
recipe_generator = Agent(
    id="recipe_generator",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a professional chef. When asked for a recipe,
provide detailed instructions including ingredients, prep time, and cooking tips.
Always respond with structured data matching the required format.""",
    output_schema=RecipeOutput,
    stop_conditions=[
        max_steps(MaxStepsConfig(count=5)),
    ],
)


# Sentiment analyzer agent with structured output
sentiment_analyzer = Agent(
    id="sentiment_analyzer",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are a sentiment analysis expert. Analyze the given text
and provide sentiment, confidence score, detected emotions, and key phrases.
Always respond with structured data matching the required format.""",
    output_schema=SentimentAnalysis,
    stop_conditions=[
        max_steps(MaxStepsConfig(count=5)),
    ],
)
