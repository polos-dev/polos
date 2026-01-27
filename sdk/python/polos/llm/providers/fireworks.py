"""Fireworks provider - routes to OpenAI provider with chat_completions API."""

from .base import register_provider
from .openai import OpenAIProvider


@register_provider("fireworks")
class FireworksProvider(OpenAIProvider):
    """Fireworks provider using OpenAI provider with Chat Completions API."""

    def __init__(self, api_key=None):
        """
        Initialize Fireworks provider.

        Args:
            api_key: Fireworks API key. If not provided, uses FIREWORKS_API_KEY env var.
        """
        import os

        fireworks_api_key = api_key or os.getenv("FIREWORKS_API_KEY")
        if not fireworks_api_key:
            raise ValueError(
                "Fireworks API key not provided. Set FIREWORKS_API_KEY "
                "environment variable or pass api_key parameter."
            )

        try:
            from openai import AsyncOpenAI  # noqa: F401
        except ImportError:
            raise ImportError(
                "OpenAI SDK not installed. Install it with: pip install 'polos[fireworks]'"
            ) from None

        # Initialize with Fireworks' base URL and chat_completions API version
        # Fireworks supports structured output
        super().__init__(
            api_key=fireworks_api_key,
            base_url="https://api.fireworks.ai/inference/v1",
            llm_api="chat_completions",
        )
        self.supports_structured_output = True
