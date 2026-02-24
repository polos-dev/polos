"""Groq provider - fast inference for open models via LiteLLM."""

import os

from .base import register_provider
from .litellm_provider import LiteLLMProvider


@register_provider("groq")
class GroqProvider(LiteLLMProvider):
    """Groq provider - fast inference for open models."""

    def __init__(self, api_key=None, **kwargs):
        groq_api_key = api_key or os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError(
                "Groq API key not provided. Set GROQ_API_KEY environment variable "
                "or pass api_key parameter."
            )

        super().__init__(provider_prefix="groq", api_key=groq_api_key, **kwargs)
