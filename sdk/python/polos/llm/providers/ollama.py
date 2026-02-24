"""Ollama provider for local LLMs via LiteLLM."""

import os

from .base import register_provider
from .litellm_provider import LiteLLMProvider


@register_provider("ollama")
class OllamaProvider(LiteLLMProvider):
    """Ollama provider for local LLMs.

    Usage:
        Agent(
            id="local-agent",
            provider="ollama",
            model="llama3",
        )

        # Or with custom host:
        Agent(
            id="local-agent",
            provider="ollama",
            model="llama3",
            provider_base_url="http://my-server:11434",
        )
    """

    def __init__(self, api_base: str | None = None, **kwargs):
        api_base = api_base or os.getenv("OLLAMA_HOST", "http://localhost:11434")

        super().__init__(
            provider_prefix="ollama",
            api_base=api_base,
            **kwargs,
        )
