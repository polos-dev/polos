"""Google Gemini provider via LiteLLM."""

import os

from .base import register_provider
from .litellm_provider import LiteLLMProvider


@register_provider("gemini")
class GeminiProvider(LiteLLMProvider):
    """Google Gemini provider."""

    def __init__(self, api_key=None, **kwargs):
        gemini_api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not gemini_api_key:
            raise ValueError(
                "Gemini API key not provided. Set GEMINI_API_KEY environment "
                "variable or pass api_key parameter."
            )

        super().__init__(provider_prefix="gemini", api_key=gemini_api_key, **kwargs)
