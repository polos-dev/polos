"""Azure OpenAI provider - routes to OpenAI provider with custom base_url."""

from .base import register_provider
from .openai import OpenAIProvider


@register_provider("azure")
class AzureProvider(OpenAIProvider):
    """Azure OpenAI provider using OpenAI provider with Azure base URL."""

    def __init__(self, api_key=None, base_url=None):
        """
        Initialize Azure OpenAI provider.

        Args:
            api_key: Azure OpenAI API key. If not provided, uses AZURE_OPENAI_API_KEY env var.
            base_url: Azure OpenAI endpoint base URL (required).
                     Format: https://<resource-name>.openai.azure.com/
        """
        import os

        azure_api_key = api_key or os.getenv("AZURE_OPENAI_API_KEY")
        if not azure_api_key:
            raise ValueError(
                "Azure OpenAI API key not provided. Set AZURE_OPENAI_API_KEY "
                "environment variable or pass api_key parameter."
            )

        if not base_url:
            raise ValueError(
                "base_url is required for Azure OpenAI provider. Provide the Azure endpoint URL."
            )

        try:
            from openai import AsyncOpenAI  # noqa: F401
        except ImportError:
            raise ImportError(
                "OpenAI SDK not installed. Install it with: pip install 'polos[openai]'"
            ) from None

        # Initialize with Azure's base URL
        super().__init__(api_key=azure_api_key, base_url=base_url)
