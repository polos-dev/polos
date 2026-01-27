"""Together provider - routes to OpenAI provider with chat_completions API."""

from .base import register_provider
from .openai import OpenAIProvider


@register_provider("together")
class TogetherProvider(OpenAIProvider):
    """Together provider using OpenAI provider with Chat Completions API."""

    def __init__(self, api_key=None):
        """
        Initialize Together provider.

        Args:
            api_key: Together API key. If not provided, uses TOGETHER_API_KEY env var.
        """
        import os

        together_api_key = api_key or os.getenv("TOGETHER_API_KEY")
        if not together_api_key:
            raise ValueError(
                "Together API key not provided. Set TOGETHER_API_KEY environment variable "
                "or pass api_key parameter."
            )

        try:
            from openai import AsyncOpenAI  # noqa: F401
        except ImportError:
            raise ImportError(
                "OpenAI SDK not installed. Install it with: pip install 'polos[together]'"
            ) from None

        # Initialize with Together's base URL and chat_completions API version
        super().__init__(
            api_key=together_api_key,
            base_url="https://api.together.xyz/v1",
            llm_api="chat_completions",
        )
        self.supports_structured_output = False
