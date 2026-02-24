"""Base class for LLM providers."""

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field

# Provider registry - providers register themselves here
_PROVIDER_REGISTRY: dict[str, type["LLMProvider"]] = {}


def register_provider(name: str):
    """
    Decorator to register an LLM provider class.

    Usage:
        @register_provider("openai")
        class OpenAIProvider(LLMProvider):
            ...

    Args:
        name: Provider name (e.g., "openai", "anthropic")

    Returns:
        Decorator function
    """

    def decorator(cls: type["LLMProvider"]) -> type["LLMProvider"]:
        _PROVIDER_REGISTRY[name.lower()] = cls
        return cls

    return decorator


class LLMResponse(BaseModel):
    """Response from an LLM call."""

    content: str | None = None
    usage: dict[str, Any] | None = Field(default_factory=dict)
    tool_calls: list[dict[str, Any]] | None = Field(default_factory=list)
    raw_output: list[dict[str, Any]] | None = Field(default_factory=list)
    model: str | None = None
    stop_reason: str | None = None


class LLMProvider(ABC):
    """Base class for LLM providers."""

    @abstractmethod
    async def generate(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        agent_config: dict[str, Any] | None = None,
        tool_results: list[dict[str, Any]] | None = None,
        **kwargs,
    ) -> LLMResponse:
        """
        Make a chat completion request to the LLM.

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            model: Model identifier (e.g., "gpt-4", "claude-3-opus")
            tools: Optional list of tool schemas for function calling
            temperature: Optional temperature parameter
            max_tokens: Optional max tokens parameter
            top_p: Optional top_p parameter for nucleus sampling
            agent_config: Optional AgentConfig dict containing system_prompt and other config
            tool_results: Optional list of tool results in OpenAI format to add to messages
            **kwargs: Provider-specific additional parameters

        Returns:
            LLMResponse with content, usage, cost, tool_calls, model, and stop_reason
        """
        pass

    def convert_history_messages(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert normalized session memory messages to provider format.

        Session memory stores tool interactions in a provider-agnostic format:
        - ``{type: "function_call", name, call_id, arguments}``
        - ``{type: "function_call_output", call_id, output}``

        This method converts them into the role-based messages each provider
        expects. The default implementation is a no-op (returns as-is).
        Providers that need conversion should override this.
        """
        return messages

    async def stream(
        self,
        messages: list[dict[str, Any]],
        model: str,
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        agent_config: dict[str, Any] | None = None,
        tool_results: list[dict[str, Any]] | None = None,
        **kwargs,
    ):
        """
        Stream responses from the LLM.

        This is an optional method. If not implemented, the system will fall back to chat().

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            model: Model identifier
            tools: Optional list of tool schemas
            temperature: Optional temperature parameter
            max_tokens: Optional max tokens parameter
            top_p: Optional top_p parameter for nucleus sampling
            agent_config: Optional AgentConfig dict containing system_prompt and other config
            tool_results: Optional list of tool results in OpenAI format to add to messages
            **kwargs: Provider-specific additional parameters

        Yields:
            Dict with event information:
            - type: "text_delta", "text_complete", "tool_call", "done", "error"
            - data: Event-specific data
        """
        # Default implementation: not supported
        raise NotImplementedError(f"Streaming not implemented for {self.__class__.__name__}")


def get_provider(provider_name: str, **kwargs) -> LLMProvider:
    """
    Get LLM provider instance by name from the registry.

    Providers are dynamically imported when requested. If a provider's SDK is not installed,
    a helpful error message will be raised.

    Args:
        provider_name: Name of the provider ("openai", "anthropic", etc.)
        **kwargs: Provider-specific initialization parameters

    Returns:
        LLMProvider instance

    Raises:
        ValueError: If the provider is not found or not supported
        ImportError: If the provider's SDK is not installed
    """
    provider_name_lower = provider_name.lower()

    # Check if already registered
    provider_class = _PROVIDER_REGISTRY.get(provider_name_lower)
    if provider_class:
        return provider_class(**kwargs)

    # Try to dynamically import the provider module
    provider_modules = {
        "openai": ".openai",
        "anthropic": ".anthropic",
        "litellm": ".litellm_provider",
        "ollama": ".ollama",
        "gemini": ".gemini",
        "groq": ".groq",
        "fireworks": ".fireworks",
        "together": ".together",
        "azure": ".azure",
    }

    module_path = provider_modules.get(provider_name_lower)
    if not module_path:
        available = ", ".join(sorted(provider_modules.keys()))
        raise ValueError(
            f"Unknown LLM provider: {provider_name}. "
            f"Supported providers: {available}. "
            f"To use a provider, install it with: pip install polos[{provider_name_lower}]"
        )

    # Dynamically import the provider module
    # This will trigger the @register_provider decorator to register the class
    try:
        if provider_name_lower == "openai":
            from . import openai  # noqa: F401
        elif provider_name_lower == "anthropic":
            from . import anthropic  # noqa: F401
        elif provider_name_lower == "litellm":
            from . import litellm_provider  # noqa: F401
        elif provider_name_lower == "ollama":
            from . import ollama  # noqa: F401
        elif provider_name_lower == "gemini":
            from . import gemini  # noqa: F401
        elif provider_name_lower == "groq":
            from . import groq  # noqa: F401
        elif provider_name_lower == "fireworks":
            from . import fireworks  # noqa: F401
        elif provider_name_lower == "together":
            from . import together  # noqa: F401
        elif provider_name_lower == "azure":
            from . import azure  # noqa: F401
    except ImportError as e:
        # The import failed - likely the SDK is not installed
        # The provider module itself will raise a more helpful error
        raise ImportError(
            f"Failed to import {provider_name} provider. "
            f"Install the required SDK with: pip install polos[{provider_name_lower}]"
        ) from e

    # After import, the provider should be registered
    provider_class = _PROVIDER_REGISTRY.get(provider_name_lower)
    if not provider_class:
        raise ValueError(
            f"Provider {provider_name} was imported but not registered. "
            f"This is likely a bug in the provider implementation."
        )

    return provider_class(**kwargs)
