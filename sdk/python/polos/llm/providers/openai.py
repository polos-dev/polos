"""OpenAI provider implementation supporting both Responses API and Chat Completions API."""

import json
import logging
import os
from typing import Any

from .base import LLMProvider, LLMResponse, register_provider

logger = logging.getLogger(__name__)


@register_provider("openai")
class OpenAIProvider(LLMProvider):
    """OpenAI provider for LLM calls supporting both Responses API and Chat Completions API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        llm_api: str = "responses",
    ):
        """
        Initialize OpenAI provider.

        Args:
            api_key: OpenAI API key. If not provided, uses OPENAI_API_KEY env var.
            base_url: Optional base URL for the API. If not provided, defaults to OpenAI's URL.
                     Useful for Azure OpenAI or other OpenAI-compatible endpoints.
            llm_api: API version to use - "responses" (default) or "chat_completions"
        """
        # Import OpenAI SDK only when this provider is used (lazy loading)
        try:
            from openai import AsyncOpenAI  # noqa: F401
        except ImportError:
            raise ImportError(
                "OpenAI SDK not installed. Install it with: pip install polos[openai]"
            ) from None

        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "OpenAI API key not provided. Set OPENAI_API_KEY environment variable "
                "or pass api_key parameter."
            )

        # Get base URL from parameter or default to OpenAI
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

        # Store API version
        self.llm_api = llm_api

        # Initialize OpenAI async client
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)

        # For chat_completions, we need supports_structured_output flag
        # This is used when llm_api is "chat_completions"
        self.supports_structured_output = True  # Can be overridden by subclasses

    def convert_history_messages(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert normalized session memory messages to OpenAI format.

        The Responses API natively accepts our normalized format
        (``function_call`` / ``function_call_output`` items), so no
        conversion is needed.

        The Chat Completions API requires role-based messages, so we
        group consecutive ``function_call`` messages into a single
        ``{role: "assistant", tool_calls: [...]}`` and convert each
        ``function_call_output`` into ``{role: "tool", ...}``.
        """
        if self.llm_api == "responses":
            # Responses API accepts function_call / function_call_output
            # items directly — no conversion needed.
            return messages

        # Chat Completions format conversion
        result: list[dict[str, Any]] = []

        i = 0
        while i < len(messages):
            msg = messages[i]
            msg_type = msg.get("type")

            if msg_type == "function_call":
                # Collect consecutive function_call messages into one
                # assistant message with tool_calls.
                tool_calls: list[dict[str, Any]] = []
                while i < len(messages) and messages[i].get("type") == "function_call":
                    fc = messages[i]
                    tool_calls.append(
                        {
                            "id": fc.get("call_id", ""),
                            "type": "function",
                            "function": {
                                "name": fc.get("name", ""),
                                "arguments": fc.get("arguments", "{}"),
                            },
                        }
                    )
                    i += 1
                result.append({"role": "assistant", "tool_calls": tool_calls})

            elif msg_type == "function_call_output":
                # Each function_call_output becomes a separate tool message.
                output = msg.get("output", "")
                result.append(
                    {
                        "role": "tool",
                        "tool_call_id": msg.get("call_id", ""),
                        "content": output if isinstance(output, str) else json.dumps(output),
                    }
                )
                i += 1

            else:
                # Regular message (role-based) — pass through.
                result.append(msg)
                i += 1

        return result

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
        """
        Make a request to OpenAI using either Responses API or Chat Completions API.

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            model: Model identifier (e.g., "gpt-4", "gpt-3.5-turbo")
            tools: Optional list of tool schemas for function calling
            temperature: Optional temperature parameter (0-2)
            max_tokens: Optional max tokens parameter
            agent_config: Optional AgentConfig dict containing system_prompt and other config
            tool_results: Optional list of tool results in OpenAI format to add to messages
            output_schema: Optional structured output schema
            output_schema_name: Optional schema name
            **kwargs: Additional OpenAI-specific parameters

        Returns:
            LLMResponse with content, usage, and tool_calls
        """
        if self.llm_api == "chat_completions":
            return await self._generate_chat_completions(
                messages,
                model,
                tools,
                temperature,
                max_tokens,
                top_p,
                agent_config,
                tool_results,
                output_schema,
                output_schema_name,
                **kwargs,
            )
        else:
            return await self._generate_responses(
                messages,
                model,
                tools,
                temperature,
                max_tokens,
                top_p,
                agent_config,
                tool_results,
                output_schema,
                output_schema_name,
                **kwargs,
            )

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
        """
        Stream responses from OpenAI using either Responses API or Chat Completions API.

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            model: Model identifier (e.g., "gpt-4", "gpt-3.5-turbo")
            tools: Optional list of tool schemas for function calling
            temperature: Optional temperature parameter (0-2)
            max_tokens: Optional max tokens parameter
            top_p: Optional top_p parameter
            agent_config: Optional AgentConfig dict containing system_prompt and other config
            tool_results: Optional list of tool results in OpenAI format to add to messages
            output_schema: Optional structured output schema
            output_schema_name: Optional schema name for structured output
            **kwargs: Additional OpenAI-specific parameters

        Yields:
            Dict with event information:
            - type: "text_delta", "tool_call", "done", "error"
            - data: Event-specific data
        """
        if self.llm_api == "chat_completions":
            async for event in self._stream_chat_completions(
                messages,
                model,
                tools,
                temperature,
                max_tokens,
                top_p,
                agent_config,
                tool_results,
                output_schema,
                output_schema_name,
                **kwargs,
            ):
                yield event
        else:
            async for event in self._stream_responses(
                messages,
                model,
                tools,
                temperature,
                max_tokens,
                top_p,
                agent_config,
                tool_results,
                output_schema,
                output_schema_name,
                **kwargs,
            ):
                yield event

    async def _generate_responses(
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
        """Generate using Responses API."""
        # Prepare messages - copy to avoid mutating input
        processed_messages = messages.copy() if messages else []

        # Add tool_results to messages (OpenAI format, no conversion needed)
        if tool_results:
            processed_messages.extend(tool_results)

        # Prepare request parameters for Responses API
        request_params = {
            "model": model,
            "input": processed_messages,
            "stream": False,
        }

        # Add system prompt from agent_config if present
        # OpenAI Responses API uses "instructions" parameter
        if agent_config and agent_config.get("system_prompt"):
            request_params["instructions"] = agent_config.get("system_prompt")

        if temperature is not None:
            request_params["temperature"] = temperature
        if max_tokens is not None:
            request_params["max_output_tokens"] = max_tokens
        if tools:
            # Validate tools format - Responses API expects:
            # {"type": "function", "name": "...", "description": "...", "parameters": {...}}
            # (name, description, parameters at top level, not nested in "function")
            validated_tools = _validate_tools_responses(tools)
            if validated_tools:
                request_params["tools"] = validated_tools
            else:
                # If tools were provided but none validated, log a warning
                if tools:
                    logger.warning("Tools provided but none were valid. Tools: %s", tools)

        # Add structured output format if output_schema is provided
        if output_schema and output_schema_name:
            request_params["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": output_schema_name,
                    "strict": True,
                    "schema": output_schema,
                }
            }

        # Add any additional kwargs
        request_params.update(kwargs)

        try:
            # Use the SDK's Responses API
            response = await self.client.responses.create(**request_params)
            if not response:
                raise RuntimeError("OpenAI API returned no response")

            response_dict = response.model_dump(exclude_none=True, mode="json")

            # Check for errors
            if response_dict.get("error"):
                error_msg = response_dict.get("error").get("message", "Unknown error")
                raise RuntimeError(f"OpenAI API error: {error_msg}")

            # Extract content from response using the output_text property
            # This property aggregates all text from output items
            content = response.output_text
            raw_output = response_dict.get("output")
            processed_messages.extend(raw_output)

            # Extract tool calls from output items
            # Tool calls are in the output items as content items with type "tool_call"
            tool_calls = []
            for output_item in response.output:
                # Output items have a type and content
                if hasattr(output_item, "type") and output_item.type == "function_call":
                    # Extract tool call information
                    tool_call_data = {
                        "id": getattr(output_item, "id", ""),
                        "call_id": getattr(output_item, "call_id", ""),
                        "type": "function",
                        "function": {
                            "name": getattr(output_item, "name", ""),
                            "arguments": getattr(output_item, "arguments", "")
                            if hasattr(output_item, "arguments")
                            else "",
                        },
                    }
                    tool_calls.append(tool_call_data)

            # Extract usage information
            # ResponseUsage has input_tokens, output_tokens, and total_tokens
            usage_data = response.usage
            usage = {
                "input_tokens": usage_data.input_tokens if usage_data else 0,
                "output_tokens": usage_data.output_tokens if usage_data else 0,
                "total_tokens": usage_data.total_tokens if usage_data else 0,
            }

            # Extract model and stop_reason from response
            response_model = getattr(response, "model", None) or model
            incomplete_details = getattr(response, "incomplete_details", None)
            if incomplete_details:
                response_stop_reason = getattr(incomplete_details, "reason", None)
            else:
                response_stop_reason = None

            return LLMResponse(
                content=content,
                usage=usage,
                tool_calls=tool_calls,
                raw_output=processed_messages,
                model=response_model,
                stop_reason=response_stop_reason,
            )

        except Exception as e:
            # Re-raise with more context
            raise RuntimeError(f"OpenAI Responses API call failed: {str(e)}") from e

    async def _generate_chat_completions(
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
        """Generate using Chat Completions API."""
        # Prepare messages - copy to avoid mutating input
        processed_messages = messages.copy() if messages else []

        # Add system prompt from agent_config if present
        # Chat Completions API uses "system" role in messages
        if agent_config and agent_config.get("system_prompt"):
            # Check if there's already a system message
            has_system = any(msg.get("role") == "system" for msg in processed_messages)
            if not has_system:
                processed_messages.insert(
                    0, {"role": "system", "content": agent_config.get("system_prompt")}
                )
            else:
                # Update existing system message
                for msg in processed_messages:
                    if msg.get("role") == "system":
                        msg["content"] = (
                            msg.get("content", "") + "\n\n" + agent_config.get("system_prompt")
                        )
                        break

        # Add tool_results to messages.
        if tool_results:
            for tool_result in tool_results:
                if tool_result.get("type") == "function_call_output":
                    tool_call_id = tool_result.get("call_id")
                    output = tool_result.get("output")
                    processed_messages.append(
                        {
                            "role": "tool",
                            "content": output if isinstance(output, str) else json.dumps(output),
                            "tool_call_id": tool_call_id,
                        }
                    )

        # Prepare request parameters for Chat Completions API
        request_params = {
            "model": model,
            "messages": processed_messages,
        }

        if temperature is not None:
            request_params["temperature"] = temperature
        if max_tokens is not None:
            request_params["max_tokens"] = max_tokens
        if top_p is not None:
            request_params["top_p"] = top_p

        if tools:
            # Chat Completions API expects tools in format:
            # [{"type": "function", "function": {"name": "...", "description": "...",
            #   "parameters": {...}}}]
            validated_tools = _validate_tools_chat_completions(tools)
            if validated_tools:
                request_params["tools"] = validated_tools

        # Handle structured output
        if output_schema:
            if (
                self.supports_structured_output
                and output_schema_name
                and not request_params.get("tools")
            ):
                # Use response_format parameter if supported and there are no tools
                request_params["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": output_schema_name,
                        "strict": True,
                        "schema": output_schema,
                    },
                }
            else:
                # Add structured output instructions to system prompt
                schema_json = json.dumps(output_schema, indent=2)
                structured_output_instruction = (
                    f"\n\nIMPORTANT: You must structure your text response as valid JSON "
                    f"that strictly conforms to this schema:\n\n{schema_json}\n\n"
                    f"Return ONLY valid JSON that matches this schema. Do not include any "
                    f"text, explanation, markdown code fences (```json or ```), or "
                    f"formatting outside of the JSON structure. Return only the raw JSON "
                    f"without any markdown formatting."
                )
                # Update system message
                has_system = any(msg.get("role") == "system" for msg in processed_messages)
                if has_system:
                    for msg in processed_messages:
                        if msg.get("role") == "system":
                            msg["content"] = msg.get("content", "") + structured_output_instruction
                            break
                else:
                    processed_messages.insert(
                        0, {"role": "system", "content": structured_output_instruction}
                    )

        # Add any additional kwargs
        request_params.update(kwargs)

        try:
            usage = {
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
            }
            response_model = model
            response_stop_reason = None
            tool_calls = []
            content = None

            # Use the Chat Completions API
            response = await self.client.chat.completions.create(**request_params)
            if not response:
                raise RuntimeError("OpenAI API returned no response")

            # Extract content from response
            if response.choices and len(response.choices) > 0:
                choice = response.choices[0]
                if not choice.message:
                    raise RuntimeError("OpenAI API returned no message")

                processed_messages.append(choice.message.model_dump(exclude_none=True, mode="json"))
                content = choice.message.content or ""
                response_stop_reason = choice.finish_reason

                # Extract tool calls
                if choice.message.tool_calls:
                    for tool_call in choice.message.tool_calls:
                        tool_calls.append(
                            {
                                "call_id": tool_call.id,
                                "id": "",
                                "type": "function",
                                "function": {
                                    "name": tool_call.function.name,
                                    "arguments": tool_call.function.arguments,
                                },
                            }
                        )

            # Extract usage information
            if response.usage:
                usage["input_tokens"] = response.usage.prompt_tokens
                usage["output_tokens"] = response.usage.completion_tokens
                usage["total_tokens"] = response.usage.total_tokens

            # Extract model and stop_reason
            response_model = response.model or model

            return LLMResponse(
                content=content,
                usage=usage,
                tool_calls=tool_calls,
                raw_output=processed_messages,
                model=response_model,
                stop_reason=response_stop_reason,
            )

        except Exception as e:
            # Re-raise with more context
            raise RuntimeError(f"OpenAI Chat Completions API call failed: {str(e)}") from e

    async def _stream_responses(
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
        """Stream using Responses API."""
        # Prepare messages - copy to avoid mutating input
        processed_messages = messages.copy() if messages else []

        # Add tool_results to messages (OpenAI format, no conversion needed)
        if tool_results:
            processed_messages.extend(tool_results)

        # Prepare request parameters for Responses API
        request_params = {
            "model": model,
            "input": processed_messages,
            "stream": True,  # Enable streaming
        }

        # Add system prompt from agent_config if present
        # OpenAI Responses API uses "instructions" parameter
        if agent_config and agent_config.get("system_prompt"):
            request_params["instructions"] = agent_config.get("system_prompt")

        if temperature is not None:
            request_params["temperature"] = temperature
        if max_tokens is not None:
            request_params["max_output_tokens"] = max_tokens
        if tools:
            # Validate tools format - Responses API expects:
            # {"type": "function", "name": "...", "description": "...", "parameters": {...}}
            validated_tools = _validate_tools_responses(tools)
            if validated_tools:
                request_params["tools"] = validated_tools

        # Add structured output format if output_schema is provided
        if output_schema and output_schema_name:
            request_params["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": output_schema_name,
                    "strict": True,
                    "schema": output_schema,
                }
            }

        # Add any additional kwargs
        request_params.update(kwargs)
        try:
            # Use the SDK's Responses API with streaming
            stream = await self.client.responses.create(**request_params)

            # The Responses API returns an async iterator of events
            # Events include: response.created, response.in_progress, response.output_item.added,
            # response.content_part.added, response.output_text.delta, response.output_text.done,
            # response.content_part.done, response.output_item.done, response.completed
            accumulated_text = ""
            tool_calls = []
            usage = {
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
            }

            async for event in stream:
                event = event.model_dump(exclude_none=True, mode="json")

                event_type = event.get("type")

                if event_type == "response.output_text.delta":
                    # Text delta - incremental text chunk
                    delta_text = event.get("delta", "")
                    if delta_text:
                        accumulated_text += delta_text
                        yield {
                            "type": "text_delta",
                            "data": {
                                "content": delta_text,
                            },
                        }

                elif event_type == "response.output_item.added":
                    # Output item added - could be message, tool call, etc.
                    # For tool calls, we wait until output_item.done to get complete arguments
                    # Just acknowledge, don't yield anything yet
                    pass

                elif event_type == "response.output_item.done":
                    # Output item done - extract final content if it's a message or tool call
                    item = event.get("item")
                    item_type = item.get("type")

                    if item_type == "function_call":
                        # Function tool call - extract complete tool call with arguments
                        tool_call_id = item.get("id", "")
                        tool_call_name = item.get("name", "")
                        tool_call_arguments = item.get("arguments", "")
                        tool_call_call_id = item.get("call_id", "")

                        if tool_call_name and tool_call_arguments:
                            tool_call_data = {
                                "id": tool_call_id,
                                "call_id": tool_call_call_id,
                                "type": "function",
                                "function": {
                                    "name": tool_call_name,
                                    "arguments": tool_call_arguments,
                                },
                            }
                            tool_calls.append(tool_call_data)
                            yield {
                                "type": "tool_call",
                                "data": {
                                    "tool_call": tool_call_data,
                                },
                            }

                elif event_type == "response.content_part.added":
                    # Content part added - could be text
                    # For tool calls, we wait until output_item.done to get complete arguments
                    part = event.get("part")
                    if part:
                        part_type = part.get("type")
                        if part_type == "output_text":
                            # Text content part
                            text = part.get("text", "")
                            if text:
                                accumulated_text += text
                                yield {
                                    "type": "text_delta",
                                    "data": {
                                        "content": text,
                                    },
                                }

                elif event_type == "response.completed":
                    # Stream complete - final event with usage
                    raw_output = None
                    response_dict = None
                    response_model = model  # Default to input model
                    response_stop_reason = None
                    response = event.get("response")
                    if response:
                        response_dict = (
                            response.model_dump(exclude_none=True, mode="json")
                            if hasattr(response, "model_dump")
                            else response
                        )
                    if response_dict:
                        raw_output = response_dict.get("output")
                        processed_messages.extend(raw_output)
                        usage_data = response_dict.get("usage")

                        if usage_data:
                            usage["input_tokens"] = usage_data.get("input_tokens", 0)
                            usage["output_tokens"] = usage_data.get("output_tokens", 0)
                            usage["total_tokens"] = usage_data.get(
                                "input_tokens", 0
                            ) + usage_data.get("output_tokens", 0)

                        response_model = response_dict.get("model", model)
                        incomplete_details = response_dict.get("incomplete_details")
                        response_stop_reason = (
                            incomplete_details.get("reason", None) if incomplete_details else None
                        )

                    yield {
                        "type": "done",
                        "data": {
                            "usage": usage,
                            "raw_output": processed_messages,
                            "model": response_model,
                            "stop_reason": response_stop_reason,
                        },
                    }

                elif event_type == "response.failed":
                    # Stream failed
                    response = event.get("response")
                    error_msg = "Stream failed"
                    if response and isinstance(response, dict):
                        error_obj = response.get("error")
                        if error_obj and isinstance(error_obj, dict):
                            error_msg = error_obj.get("message", "Stream failed")

                    yield {
                        "type": "error",
                        "data": {
                            "error": error_msg,
                        },
                    }
                    break

                elif event_type == "error":
                    # Error event
                    error_msg = event.get("message", "Unknown error")
                    error_code = event.get("code", "")
                    if error_code:
                        error_msg = f"{error_code}: {error_msg}"

                    yield {
                        "type": "error",
                        "data": {
                            "error": error_msg,
                        },
                    }
                    break

        except Exception as e:
            # Yield error event and re-raise
            yield {
                "type": "error",
                "data": {
                    "error": str(e),
                },
            }
            raise RuntimeError(f"OpenAI Responses API streaming failed: {str(e)}") from e

    async def _stream_chat_completions(
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
        """Stream using Chat Completions API."""
        # Prepare messages - copy to avoid mutating input
        processed_messages = messages.copy() if messages else []

        # Add system prompt from agent_config if present
        if agent_config and agent_config.get("system_prompt"):
            has_system = any(msg.get("role") == "system" for msg in processed_messages)
            if not has_system:
                processed_messages.insert(
                    0, {"role": "system", "content": agent_config.get("system_prompt")}
                )
            else:
                for msg in processed_messages:
                    if msg.get("role") == "system":
                        msg["content"] = (
                            msg.get("content", "") + "\n\n" + agent_config.get("system_prompt")
                        )
                        break

        # Add tool_results to messages
        if tool_results:
            for tool_result in tool_results:
                if tool_result.get("type") == "function_call_output":
                    tool_call_id = tool_result.get("call_id")
                    output = tool_result.get("output")
                    processed_messages.append(
                        {
                            "role": "tool",
                            "content": output if isinstance(output, str) else json.dumps(output),
                            "tool_call_id": tool_call_id,
                        }
                    )

        # Prepare request parameters for Chat Completions API
        request_params = {
            "model": model,
            "messages": processed_messages,
            "stream": True,  # Enable streaming
        }

        if temperature is not None:
            request_params["temperature"] = temperature
        if max_tokens is not None:
            request_params["max_tokens"] = max_tokens
        if top_p is not None:
            request_params["top_p"] = top_p

        if tools:
            validated_tools = _validate_tools_chat_completions(tools)
            if validated_tools:
                request_params["tools"] = validated_tools

        # Handle structured output
        if output_schema:
            if (
                self.supports_structured_output
                and output_schema_name
                and not request_params.get("tools")
            ):
                # Use response_format parameter if supported
                request_params["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": output_schema_name,
                        "strict": True,
                        "schema": output_schema,
                    },
                }
            else:
                # Add structured output instructions to system prompt (like Anthropic)
                schema_json = json.dumps(output_schema, indent=2)
                structured_output_instruction = (
                    f"\n\nIMPORTANT: You must structure your text response as valid JSON "
                    f"that strictly conforms to this schema:\n\n{schema_json}\n\n"
                    f"Return ONLY valid JSON that matches this schema. Do not include any "
                    f"text, explanation, markdown code fences (```json or ```), or "
                    f"formatting outside of the JSON structure. Return only the raw JSON "
                    f"without any markdown formatting."
                )
                # Update system message
                has_system = any(msg.get("role") == "system" for msg in processed_messages)
                if has_system:
                    for msg in processed_messages:
                        if msg.get("role") == "system":
                            msg["content"] = msg.get("content", "") + structured_output_instruction
                            break
                else:
                    processed_messages.insert(
                        0, {"role": "system", "content": structured_output_instruction}
                    )

        # Add any additional kwargs
        request_params.update(kwargs)

        tool_calls = []
        usage = {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
        }
        stop_reason = None
        response_model = model
        accumulated_text = ""
        accumulated_tool_calls = []

        try:
            # Stream from Chat Completions API
            stream = await self.client.chat.completions.create(**request_params)

            async for chunk in stream:
                # Process streaming chunks
                if chunk.choices and len(chunk.choices) > 0:
                    choice = chunk.choices[0]
                    delta = choice.delta

                    # Extract text delta
                    if delta.content:
                        accumulated_text += delta.content
                        yield {
                            "type": "text_delta",
                            "data": {
                                "content": delta.content,
                            },
                        }

                    # Extract tool calls
                    if delta.tool_calls:
                        for tool_call_delta in delta.tool_calls:
                            # Tool calls come in parts - need to accumulate
                            idx = tool_call_delta.index
                            delta_dict = tool_call_delta.model_dump(exclude_none=True, mode="json")

                            if idx is None or len(tool_calls) <= idx:
                                # New tool call
                                tool_calls.append(
                                    {
                                        "call_id": tool_call_delta.id or "",
                                        "id": "",
                                        "type": "function",
                                        "function": {
                                            "name": tool_call_delta.function.name or "",
                                            "arguments": tool_call_delta.function.arguments or "",
                                        },
                                    }
                                )

                                # To feed back to the next model request
                                accumulated_tool_calls.append(
                                    {
                                        "id": delta_dict.get("id"),
                                        "type": delta_dict.get("type"),
                                        "function": delta_dict.get("function"),
                                    }
                                )

                                # Merge any extra top-level fields
                                # (preserve new fields, don't overwrite existing)
                                known_keys = {"index", "id", "function", "type"}
                                for key, value in delta_dict.items():
                                    if (
                                        key not in known_keys
                                        and key not in accumulated_tool_calls[-1]
                                    ):
                                        accumulated_tool_calls[-1][key] = value

                            else:
                                # Append to existing tool call
                                existing = tool_calls[idx]
                                accumulated_existing = accumulated_tool_calls[idx]
                                if tool_call_delta.function.name:
                                    existing["function"]["name"] = tool_call_delta.function.name
                                    accumulated_existing["function"]["name"] = (
                                        tool_call_delta.function.name
                                    )
                                if tool_call_delta.function.arguments:
                                    existing["function"]["arguments"] += (
                                        tool_call_delta.function.arguments
                                    )
                                    accumulated_existing["function"]["arguments"] += (
                                        tool_call_delta.function.arguments
                                    )

                                # Merge any extra top-level fields
                                # (preserve new fields, don't overwrite existing)
                                known_keys = {"index", "id", "function", "type"}
                                for key, value in delta_dict.items():
                                    if key not in known_keys and key not in accumulated_existing:
                                        accumulated_existing[key] = value

                    # Update finish_reason if available
                    if choice.finish_reason:
                        stop_reason = choice.finish_reason

                # Update model if available
                if chunk.model:
                    response_model = chunk.model

                # Update usage if available
                if chunk.usage:
                    usage["input_tokens"] = chunk.usage.prompt_tokens or 0
                    usage["output_tokens"] = chunk.usage.completion_tokens or 0
                    usage["total_tokens"] = chunk.usage.total_tokens or 0

            # Yield tool calls if any
            for tool_call in tool_calls:
                if tool_call["function"]["name"]:  # Only yield complete tool calls
                    yield {
                        "type": "tool_call",
                        "data": {
                            "tool_call": tool_call,
                        },
                    }

            # Final done event
            usage["total_tokens"] = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)

            processed_messages.append(
                {
                    "role": "assistant",
                    "content": accumulated_text,
                    "tool_calls": accumulated_tool_calls,
                }
            )
            yield {
                "type": "done",
                "data": {
                    "usage": usage,
                    "model": response_model,
                    "stop_reason": stop_reason,
                    "raw_output": processed_messages,
                },
            }

        except Exception as e:
            # Stream error
            yield {
                "type": "error",
                "data": {
                    "error": str(e),
                },
            }


def _validate_tools_responses(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Validate tools for Responses API format."""
    validated_tools = []
    for tool in tools:
        # Default to type "function" if not specified
        if "type" not in tool:
            tool["type"] = "function"

        validated_tools.append(tool)
    return validated_tools


def _validate_tools_chat_completions(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """
    Validate and normalize tools to OpenAI Chat Completions format.

    OpenAI Chat Completions expects:
    [{"type": "function", "function": {"name": "...", "description": "...", "parameters": {...}}}]
    """
    validated = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue

        # Handle OpenAI format: {"type": "function", "function": {...}}
        if tool.get("type", "function") == "function":
            if tool.get("name"):
                validated.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool.get("name"),
                            "description": tool.get("description", ""),
                            "parameters": tool.get("parameters", {}),
                        },
                    }
                )
        else:
            validated.append(tool)

    return validated
