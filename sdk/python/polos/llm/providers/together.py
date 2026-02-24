"""Together AI provider via LiteLLM."""

import os

from .base import register_provider
from .litellm_provider import LiteLLMProvider


@register_provider("together")
class TogetherProvider(LiteLLMProvider):
    """Together AI provider for open-source models."""

    def __init__(self, api_key=None, **kwargs):
        together_api_key = api_key or os.getenv("TOGETHER_API_KEY")
        if not together_api_key:
            raise ValueError(
                "Together API key not provided. Set TOGETHER_API_KEY environment variable "
                "or pass api_key parameter."
            )

        super().__init__(provider_prefix="together_ai", api_key=together_api_key, **kwargs)
