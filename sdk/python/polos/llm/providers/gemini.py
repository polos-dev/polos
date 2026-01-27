"""Gemini provider - routes to OpenAI provider with chat_completions API."""

from .base import register_provider
from .openai import OpenAIProvider


@register_provider("gemini")
class GeminiProvider(OpenAIProvider):
    """Gemini provider using OpenAI provider with Chat Completions API."""

    def __init__(self, api_key=None):
        """
        Initialize Gemini provider.

        Args:
            api_key: Gemini API key. If not provided, uses GEMINI_API_KEY env var.
        """
        import os

        gemini_api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not gemini_api_key:
            raise ValueError(
                "Gemini API key not provided. Set GEMINI_API_KEY environment "
                "variable or pass api_key parameter."
            )

        try:
            from openai import AsyncOpenAI  # noqa: F401
        except ImportError:
            raise ImportError(
                "OpenAI SDK not installed. Install it with: pip install 'polos[openai]'"
            ) from None

        # Initialize with Gemini's base URL and chat_completions API version
        super().__init__(
            api_key=gemini_api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            llm_api="chat_completions",
        )
        self.supports_structured_output = True
