"""Universal LLM provider powered by LiteLLM.

Supports 100+ providers including Ollama, Groq, Together, Fireworks,
Gemini, Azure, Bedrock, Vertex, Mistral, Cohere, DeepSeek, and more.
"""

import json
import logging
from typing import Any

from .base import LLMProvider, LLMResponse, register_provider

logger = logging.getLogger(__name__)


@register_provider("litellm")
class LiteLLMProvider(LLMProvider):
    """Universal LLM provider powered by LiteLLM.

    Model strings follow LiteLLM conventions:
        - "ollama/llama3"          -> Ollama
        - "groq/llama-3.1-70b"    -> Groq
        - "together_ai/meta-llama/Meta-Llama-3.1-70B" -> Together
        - "gemini/gemini-1.5-pro"  -> Google Gemini
        - "azure/gpt-4o"           -> Azure OpenAI
        - "bedrock/anthropic.claude-3-sonnet" -> AWS Bedrock
        - "deepseek/deepseek-chat" -> DeepSeek
    """

    def __init__(
        self,
        api_key: str | None = None,
        api_base: str | None = None,
        provider_prefix: str | None = None,
        **kwargs,
    ):
        try:
            import litellm  # noqa: F401
        except ImportError:
            raise ImportError(
                "LiteLLM not installed. Install it with: pip install polos-sdk[litellm]"
            ) from None

        self.api_key = api_key
        self.api_base = api_base
        self.provider_prefix = provider_prefix
        self.extra_kwargs = kwargs

        # Disable LiteLLM's telemetry by default
        litellm.telemetry = False

    def _resolve_model(self, model: str) -> str:
        """Prepend provider prefix if model doesn't already contain one.

        If user passes model="llama-3.1-70b" and provider_prefix="groq",
        this returns "groq/llama-3.1-70b".

        If user passes model="groq/llama-3.1-70b", this returns it as-is.
        """
        if self.provider_prefix and "/" not in model:
            return f"{self.provider_prefix}/{model}"
        return model

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
        output_schema: dict[str, Any] | None = None,
        output_schema_name: str | None = None,
        **kwargs,
    ) -> LLMResponse:
        import litellm

        resolved_model = self._resolve_model(model)
        llm_messages = self._build_messages(messages, agent_config, tool_results)

        # Handle structured output via system prompt injection
        if output_schema:
            self._inject_output_schema(llm_messages, output_schema)

        call_kwargs: dict[str, Any] = {
            "model": resolved_model,
            "messages": llm_messages,
        }

        if temperature is not None:
            call_kwargs["temperature"] = temperature
        if max_tokens is not None:
            call_kwargs["max_tokens"] = max_tokens
        if top_p is not None:
            call_kwargs["top_p"] = top_p
        if self.api_key:
            call_kwargs["api_key"] = self.api_key
        if self.api_base:
            call_kwargs["api_base"] = self.api_base

        if tools:
            call_kwargs["tools"] = self._convert_tools(tools)

        call_kwargs.update(self.extra_kwargs)
        call_kwargs.update(kwargs)

        response = await litellm.acompletion(**call_kwargs)

        return self._parse_response(response, model)

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
        output_schema: dict[str, Any] | None = None,
        output_schema_name: str | None = None,
        **kwargs,
    ):
        import litellm

        resolved_model = self._resolve_model(model)
        llm_messages = self._build_messages(messages, agent_config, tool_results)

        if output_schema:
            self._inject_output_schema(llm_messages, output_schema)

        call_kwargs: dict[str, Any] = {
            "model": resolved_model,
            "messages": llm_messages,
            "stream": True,
        }

        if temperature is not None:
            call_kwargs["temperature"] = temperature
        if max_tokens is not None:
            call_kwargs["max_tokens"] = max_tokens
        if top_p is not None:
            call_kwargs["top_p"] = top_p
        if self.api_key:
            call_kwargs["api_key"] = self.api_key
        if self.api_base:
            call_kwargs["api_base"] = self.api_base
        if tools:
            call_kwargs["tools"] = self._convert_tools(tools)

        call_kwargs.update(self.extra_kwargs)
        call_kwargs.update(kwargs)

        response = await litellm.acompletion(**call_kwargs)

        full_content = ""
        tool_calls_map: dict[int, dict] = {}
        usage = {}
        model_name = resolved_model
        accumulated_tool_calls = []

        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            finish_reason = chunk.choices[0].finish_reason if chunk.choices else None

            if delta and delta.content:
                full_content += delta.content
                yield {"type": "text_delta", "data": {"content": delta.content}}

            if delta and delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_map:
                        tool_calls_map[idx] = {
                            "call_id": tc.id or "",
                            "id": "",
                            "type": "function",
                            "function": {"name": "", "arguments": ""},
                        }
                    if tc.id:
                        tool_calls_map[idx]["call_id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            tool_calls_map[idx]["function"]["name"] = tc.function.name
                        if tc.function.arguments:
                            tool_calls_map[idx]["function"]["arguments"] += (
                                tc.function.arguments
                            )

            if chunk.model:
                model_name = chunk.model

            if hasattr(chunk, "usage") and chunk.usage:
                usage = {
                    "input_tokens": getattr(chunk.usage, "prompt_tokens", 0) or 0,
                    "output_tokens": getattr(chunk.usage, "completion_tokens", 0) or 0,
                    "total_tokens": getattr(chunk.usage, "total_tokens", 0) or 0,
                }

            if finish_reason:
                for tc_data in tool_calls_map.values():
                    yield {
                        "type": "tool_call",
                        "data": {"tool_call": tc_data},
                    }
                    accumulated_tool_calls.append({
                        "id": tc_data.get("call_id") or tc_data.get("id"),
                        "type": "function",
                        "function": tc_data["function"],
                    })

                llm_messages.append({
                    "role": "assistant",
                    "content": full_content,
                    "tool_calls": accumulated_tool_calls,
                })

                yield {
                    "type": "done",
                    "data": {
                        "content": full_content or None,
                        "usage": usage,
                        "model": model_name,
                        "stop_reason": finish_reason,
                        "raw_output": llm_messages,
                    },
                }

    def convert_history_messages(
        self, messages: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Convert normalized messages to OpenAI chat completions format.

        LiteLLM uses OpenAI message format, so we convert function_call /
        function_call_output items into assistant tool_calls + tool messages.
        """
        converted = []
        pending_tool_calls = []

        for msg in messages:
            content_items = msg.get("content", [])
            if isinstance(content_items, str):
                converted.append(msg)
                continue

            for item in content_items:
                if item.get("type") == "function_call":
                    pending_tool_calls.append({
                        "id": item.get("call_id", ""),
                        "type": "function",
                        "function": {
                            "name": item.get("name", ""),
                            "arguments": item.get("arguments", ""),
                        },
                    })
                elif item.get("type") == "function_call_output":
                    if pending_tool_calls:
                        converted.append({
                            "role": "assistant",
                            "tool_calls": pending_tool_calls,
                        })
                        pending_tool_calls = []
                    converted.append({
                        "role": "tool",
                        "tool_call_id": item.get("call_id", ""),
                        "content": item.get("output", ""),
                    })
                else:
                    if pending_tool_calls:
                        converted.append({
                            "role": "assistant",
                            "tool_calls": pending_tool_calls,
                        })
                        pending_tool_calls = []
                    converted.append(msg)
                    break

        if pending_tool_calls:
            converted.append({
                "role": "assistant",
                "tool_calls": pending_tool_calls,
            })

        return converted

    def _build_messages(
        self,
        messages: list[dict[str, Any]],
        agent_config: dict[str, Any] | None,
        tool_results: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        """Build the full message list for the API call."""
        llm_messages = []

        if agent_config and agent_config.get("system_prompt"):
            llm_messages.append({
                "role": "system",
                "content": agent_config["system_prompt"],
            })

        llm_messages.extend(messages)

        if tool_results:
            for tr in tool_results:
                if tr.get("type") == "function_call_output":
                    output = tr.get("output", "")
                    llm_messages.append({
                        "role": "tool",
                        "tool_call_id": tr.get("call_id", ""),
                        "content": output if isinstance(output, str) else json.dumps(output),
                    })

        return llm_messages

    def _convert_tools(
        self, tools: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Convert Polos tool format to OpenAI function calling format."""
        converted = []
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            if tool.get("type") == "function" and "function" in tool:
                converted.append(tool)
            elif tool.get("name"):
                converted.append({
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool.get("description", ""),
                        "parameters": tool.get("parameters", {}),
                    },
                })
            else:
                converted.append(tool)
        return converted

    def _inject_output_schema(
        self,
        messages: list[dict[str, Any]],
        output_schema: dict[str, Any],
    ) -> None:
        """Inject structured output instructions into the system message."""
        schema_json = json.dumps(output_schema, indent=2)
        instruction = (
            f"\n\nIMPORTANT: You must structure your text response as valid JSON "
            f"that strictly conforms to this schema:\n\n{schema_json}\n\n"
            f"Return ONLY valid JSON that matches this schema. Do not include any "
            f"text, explanation, markdown code fences (```json or ```), or "
            f"formatting outside of the JSON structure. Return only the raw JSON "
            f"without any markdown formatting."
        )
        has_system = any(msg.get("role") == "system" for msg in messages)
        if has_system:
            for msg in messages:
                if msg.get("role") == "system":
                    msg["content"] = msg.get("content", "") + instruction
                    break
        else:
            messages.insert(0, {"role": "system", "content": instruction})

    def _parse_response(self, response, fallback_model: str) -> LLMResponse:
        """Parse LiteLLM response into LLMResponse."""
        choice = response.choices[0] if response.choices else None
        message = choice.message if choice else None

        content = message.content if message else None

        tool_calls = []
        if message and message.tool_calls:
            for tc in message.tool_calls:
                tool_calls.append({
                    "call_id": tc.id,
                    "id": "",
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                })

        usage = {}
        if response.usage:
            usage = {
                "input_tokens": response.usage.prompt_tokens or 0,
                "output_tokens": response.usage.completion_tokens or 0,
                "total_tokens": response.usage.total_tokens or 0,
            }

        return LLMResponse(
            content=content,
            usage=usage,
            tool_calls=tool_calls,
            raw_output=[message.model_dump() if message else {}],
            model=response.model or fallback_model,
            stop_reason=choice.finish_reason if choice else None,
        )
