"""Groq provider - routes to OpenAI provider with chat_completions API."""

from .base import register_provider
from .openai import OpenAIProvider


@register_provider("groq")
class GroqProvider(OpenAIProvider):
    """Groq provider using OpenAI provider with Chat Completions API."""

    def __init__(self, api_key=None):
        """
        Initialize Groq provider.

        Args:
            api_key: Groq API key. If not provided, uses GROQ_API_KEY env var.
        """
        import os

        groq_api_key = api_key or os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError(
                "Groq API key not provided. Set GROQ_API_KEY environment variable "
                "or pass api_key parameter."
            )

        try:
            from openai import AsyncOpenAI  # noqa: F401
        except ImportError:
            raise ImportError(
                "OpenAI SDK not installed. Install it with: pip install polos[groq]"
            ) from None

        # Initialize with Groq's base URL and chat_completions API version
        super().__init__(
            api_key=groq_api_key,
            base_url="https://api.groq.com/openai/v1",
            llm_api="chat_completions",
        )
        self.supports_structured_output = False
