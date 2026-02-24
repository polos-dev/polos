"""Azure OpenAI provider via LiteLLM."""

import os

from .base import register_provider
from .litellm_provider import LiteLLMProvider


@register_provider("azure")
class AzureProvider(LiteLLMProvider):
    """Azure OpenAI provider."""

    def __init__(self, api_key=None, base_url=None, **kwargs):
        azure_api_key = api_key or os.getenv("AZURE_OPENAI_API_KEY")
        if not azure_api_key:
            raise ValueError(
                "Azure OpenAI API key not provided. Set AZURE_OPENAI_API_KEY "
                "environment variable or pass api_key parameter."
            )

        super().__init__(
            provider_prefix="azure",
            api_key=azure_api_key,
            api_base=base_url,
            **kwargs,
        )
