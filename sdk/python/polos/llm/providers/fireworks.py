"""Fireworks AI provider via LiteLLM."""

import os

from .base import register_provider
from .litellm_provider import LiteLLMProvider


@register_provider("fireworks")
class FireworksProvider(LiteLLMProvider):
    """Fireworks AI provider for fast open-source model inference."""

    def __init__(self, api_key=None, **kwargs):
        fireworks_api_key = api_key or os.getenv("FIREWORKS_API_KEY")
        if not fireworks_api_key:
            raise ValueError(
                "Fireworks API key not provided. Set FIREWORKS_API_KEY "
                "environment variable or pass api_key parameter."
            )

        super().__init__(provider_prefix="fireworks_ai", api_key=fireworks_api_key, **kwargs)
