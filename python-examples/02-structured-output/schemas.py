"""Pydantic schemas for structured output."""

from pydantic import BaseModel, Field


class MovieReview(BaseModel):
    """Structured output schema for movie reviews."""

    title: str = Field(description="The title of the movie")
    rating: int = Field(ge=1, le=10, description="Rating from 1-10")
    genre: str = Field(description="The movie's genre(s)")
    summary: str = Field(description="A brief summary of the movie")
    pros: list[str] = Field(description="List of positive aspects")
    cons: list[str] = Field(description="List of negative aspects")
    recommendation: str = Field(description="Who should watch this movie")


class RecipeOutput(BaseModel):
    """Structured output schema for recipes."""

    name: str = Field(description="Name of the recipe")
    prep_time_minutes: int = Field(description="Preparation time in minutes")
    cook_time_minutes: int = Field(description="Cooking time in minutes")
    servings: int = Field(description="Number of servings")
    difficulty: str = Field(description="Difficulty level: Easy, Medium, or Hard")
    ingredients: list[str] = Field(description="List of ingredients with quantities")
    instructions: list[str] = Field(description="Step-by-step cooking instructions")
    tips: list[str] = Field(default=[], description="Optional cooking tips")


class SentimentAnalysis(BaseModel):
    """Structured output schema for sentiment analysis."""

    text: str = Field(description="The analyzed text")
    sentiment: str = Field(description="Overall sentiment: positive, negative, or neutral")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score 0-1")
    emotions: list[str] = Field(description="Detected emotions")
    key_phrases: list[str] = Field(description="Key phrases that influenced the analysis")
