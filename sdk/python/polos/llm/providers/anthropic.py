"""Anthropic provider implementation."""

import json
import os
from typing import Any

from .base import LLMProvider, LLMResponse, register_provider


@register_provider("anthropic")
class AnthropicProvider(LLMProvider):
    """Anthropic provider for LLM calls using the Messages API."""

    def __init__(self, api_key: str | None = None):
        """
        Initialize Anthropic provider.

        Args:
            api_key: Anthropic API key. If not provided, uses ANTHROPIC_API_KEY env var.
        """
        # Import Anthropic SDK only when this provider is used (lazy loading)
        try:
            from anthropic import AsyncAnthropic
        except ImportError:
            raise ImportError(
                "Anthropic SDK not installed. Install it with: pip install 'polos[anthropic]'"
            ) from None

        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError(
                "Anthropic API key not provided. Set ANTHROPIC_API_KEY "
                "environment variable or pass api_key parameter."
            )

        # Initialize Anthropic async client
        self.client = AsyncAnthropic(api_key=self.api_key)

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
        Make a request to Anthropic using the Messages API.

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            model: Model identifier (e.g., "claude-sonnet-4-5-20250929", "claude-3-opus-20240229")
            tools: Optional list of tool schemas for function calling
            temperature: Optional temperature parameter (0-1)
            max_tokens: Required max tokens parameter (or from kwargs)
            agent_config: Optional AgentConfig dict containing system_prompt and other config
            tool_results: Optional list of tool results in OpenAI format to add to messages
            output_schema: Optional structured output schema (not yet supported by Anthropic)
            output_schema_name: Optional schema name (not yet supported by Anthropic)
            **kwargs: Additional Anthropic-specific parameters

        Returns:
            LLMResponse with content, usage, and tool_calls
        """
        # Prepare messages - copy to avoid mutating input
        processed_messages = messages.copy() if messages else []

        # Add system prompt from agent_config if present
        if agent_config and agent_config.get("system_prompt"):
            # Anthropic uses "system" parameter, not in messages
            system_prompt = agent_config.get("system_prompt")
        else:
            system_prompt = None

        # Convert tool_results from OpenAI format to Anthropic format and add to messages
        if tool_results:
            # Find the last assistant message or create a new one
            # Tool results should be added as a new message with role "user"
            # containing tool_result blocks
            tool_result_blocks = []
            for tool_result in tool_results:
                if tool_result.get("type") == "function_call_output":
                    call_id = tool_result.get("call_id")
                    output = tool_result.get("output")
                    # Convert to Anthropic format
                    # content can be string or array, we'll use string for now
                    tool_result_block = {
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": output if isinstance(output, str) else json.dumps(output),
                        "is_error": False,
                    }
                    tool_result_blocks.append(tool_result_block)

            if tool_result_blocks:
                # Add tool results as a new user message
                processed_messages.append({"role": "user", "content": tool_result_blocks})

        # Add structured output instructions to system prompt if output_schema is provided
        if output_schema:
            schema_json = json.dumps(output_schema, indent=2)
            structured_output_instruction = (
                f"\n\nIMPORTANT: You must structure your response as valid JSON "
                f"that strictly conforms to this schema:\n\n{schema_json}\n\n"
                f"Return ONLY valid JSON that matches this schema. Do not include "
                f"any text, explanation, markdown code fences (```json or ```), or "
                f"formatting outside of the JSON structure. Return only the raw JSON "
                f"without any markdown formatting."
            )
            if system_prompt:
                system_prompt = system_prompt + structured_output_instruction
            else:
                system_prompt = structured_output_instruction

        # Prepare request parameters for Messages API
        request_params: dict[str, Any] = {
            "model": model,
            "messages": processed_messages,
        }

        # Add system prompt if present
        if system_prompt:
            request_params["system"] = system_prompt

        # max_tokens is required for Anthropic
        if max_tokens is not None:
            request_params["max_tokens"] = max_tokens
        elif "max_tokens" not in kwargs:
            # Default to 4K if not provided
            request_params["max_tokens"] = 4096

        if temperature is not None:
            request_params["temperature"] = temperature
        if top_p is not None:
            request_params["top_p"] = top_p

        if tools:
            # Anthropic expects tools in this format:
            # [{"name": "...", "description": "...", "input_schema": {...}}]
            validated_tools = _validate_tools(tools)
            if validated_tools:
                request_params["tools"] = validated_tools

        # Add any additional kwargs
        request_params.update(kwargs)
        try:
            # Use the SDK's Messages API
            response = await self.client.messages.create(**request_params)
            if not response:
                raise RuntimeError("Anthropic API returned no response")

            # Extract content from response
            # Response.content is a list of content blocks
            content_parts = []
            raw_output = []
            for content_block in response.content:
                raw_output.append(
                    content_block.model_dump(exclude_none=True)
                    if hasattr(content_block, "model_dump")
                    else json.dumps(content_block)
                )
                if content_block.type == "text":
                    content_parts.append(content_block.text)

            content = "".join(content_parts)

            # Extract tool calls from response
            tool_calls = []
            for content_block in response.content:
                if content_block.type == "tool_use":
                    # Anthropic returns tool_use blocks with input as a dict
                    input_data = content_block.input
                    if hasattr(input_data, "model_dump"):
                        # Pydantic model, convert to dict then JSON
                        arguments = json.dumps(input_data.model_dump())
                    elif isinstance(input_data, dict):
                        # Already a dict, convert to JSON string
                        arguments = json.dumps(input_data)
                    else:
                        # Fallback to string representation
                        arguments = str(input_data)

                    tool_call_data = {
                        "call_id": content_block.id,
                        "id": "",
                        "type": "function",
                        "function": {"name": content_block.name, "arguments": arguments},
                    }
                    tool_calls.append(tool_call_data)

            # Extract usage information
            usage_data = response.usage
            usage = {
                "input_tokens": usage_data.input_tokens if usage_data else 0,
                "output_tokens": usage_data.output_tokens if usage_data else 0,
                "total_tokens": (usage_data.input_tokens + usage_data.output_tokens)
                if usage_data
                else 0,
            }

            # Extract model and stop_reason from response
            response_model = getattr(response, "model", None) or model
            response_stop_reason = getattr(response, "stop_reason", None)

            processed_messages.append(
                {
                    "role": "assistant",
                    "content": raw_output,
                }
            )

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
            raise RuntimeError(f"Anthropic Messages API call failed: {str(e)}") from e

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
        Stream responses from Anthropic using the Messages API.

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            model: Model identifier (e.g., "claude-sonnet-4-5-20250929")
            tools: Optional list of tool schemas for function calling
            temperature: Optional temperature parameter (0-1)
            max_tokens: Required max tokens parameter (or from kwargs)
            agent_config: Optional AgentConfig dict containing system_prompt and other config
            tool_results: Optional list of tool results in OpenAI format to add to messages
            output_schema: Optional structured output schema (not yet supported)
            output_schema_name: Optional schema name (not yet supported)
            **kwargs: Additional Anthropic-specific parameters

        Yields:
            Dict with event information:
            - type: "text_delta", "tool_call", "done", "error"
            - data: Event-specific data
        """
        # Prepare messages - copy to avoid mutating input
        processed_messages = messages.copy() if messages else []

        # Add system prompt from agent_config if present
        if agent_config and agent_config.get("system_prompt"):
            # Anthropic uses "system" parameter, not in messages
            system_prompt = agent_config.get("system_prompt")
        else:
            system_prompt = None

        # Convert tool_results from OpenAI format to Anthropic format and add to messages
        if tool_results:
            # Find the last assistant message or create a new one
            # Tool results should be added as a new message with role "user"
            # containing tool_result blocks
            tool_result_blocks = []
            for tool_result in tool_results:
                if tool_result.get("type") == "function_call_output":
                    call_id = tool_result.get("call_id")
                    output = tool_result.get("output")
                    # Convert to Anthropic format
                    # content can be string or array, we'll use string for now
                    tool_result_block = {
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": output if isinstance(output, str) else json.dumps(output),
                        "is_error": False,
                    }
                    tool_result_blocks.append(tool_result_block)

            if tool_result_blocks:
                # Add tool results as a new user message
                processed_messages.append({"role": "user", "content": tool_result_blocks})

        # Add structured output instructions to system prompt if output_schema is provided
        if output_schema:
            schema_json = json.dumps(output_schema, indent=2)
            structured_output_instruction = (
                f"\n\nIMPORTANT: You must structure your response as valid JSON "
                f"that strictly conforms to this schema:\n\n{schema_json}\n\n"
                f"Return ONLY valid JSON that matches this schema. Do not include "
                f"any text, explanation, markdown code fences (```json or ```), or "
                f"formatting outside of the JSON structure. Return only the raw JSON "
                f"without any markdown formatting."
            )
            if system_prompt:
                system_prompt = system_prompt + structured_output_instruction
            else:
                system_prompt = structured_output_instruction

        # Prepare request parameters for Messages API
        request_params: dict[str, Any] = {
            "model": model,
            "messages": processed_messages,
            "stream": True,  # Enable streaming
        }

        # Add system prompt if present
        if system_prompt:
            request_params["system"] = system_prompt

        # max_tokens is required for Anthropic
        if max_tokens is not None:
            request_params["max_tokens"] = max_tokens
        elif "max_tokens" not in kwargs:
            # Default to 64K if not provided for streaming
            request_params["max_tokens"] = 64000

        if temperature is not None:
            request_params["temperature"] = temperature
        if top_p is not None:
            request_params["top_p"] = top_p

        if tools:
            # Anthropic expects tools in this format:
            # [{"name": "...", "description": "...", "input_schema": {...}}]
            validated_tools = _validate_tools(tools)
            if validated_tools:
                request_params["tools"] = validated_tools

        # Add any additional kwargs
        request_params.update(kwargs)
        try:
            # Use the SDK's Messages API with streaming
            stream = await self.client.messages.create(**request_params)

            tool_calls = []
            usage = {
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
            }
            stop_reason = None
            response_model = model

            # Track current tool_use block state
            current_tool_use = None  # {id, name, partial_json}
            accumulated_partial_json = ""
            accumulated_content_blocks = []
            accumulated_text = ""
            accumulated_thinking = ""
            accumulated_signature = ""

            async for event in stream:
                # Event types: message_start, content_block_start, content_block_delta,
                # content_block_stop, message_delta, message_stop
                event_type = event.type
                event = event.model_dump() if hasattr(event, "model_dump") else json.dumps(event)

                if event_type == "content_block_start":
                    # Content block starting - could be text or tool_use
                    if event.get("content_block"):
                        content_block = event.get("content_block")
                        if content_block.get("type") == "text":
                            content_text = content_block.get("text")
                            if content_text:
                                accumulated_text += content_text
                                yield {
                                    "type": "text_delta",
                                    "data": {
                                        "content": content_text,
                                    },
                                }

                        elif content_block.get("type") == "tool_use":
                            # Start tracking a tool_use block
                            current_tool_use = {
                                "id": content_block.get("id"),
                                "name": content_block.get("name"),
                                "partial_json": "",
                            }
                            accumulated_partial_json = ""

                        elif content_block.get("type") == "thinking":
                            accumulated_thinking = content_block.get("content", "")
                            accumulated_signature = content_block.get("signature", "")

                elif event_type == "content_block_delta":
                    # Content delta - could be text_delta or input_json_delta
                    if event.get("delta"):
                        delta = event.get("delta")
                        if delta.get("type") == "text_delta":
                            # Text delta - incremental text chunk
                            delta_text = delta.get("text")
                            if delta_text:
                                accumulated_text += delta_text
                                yield {
                                    "type": "text_delta",
                                    "data": {
                                        "content": delta_text,
                                    },
                                }
                        elif delta.get("type") == "input_json_delta" and delta.get("partial_json"):
                            # Tool use input JSON delta - accumulate partial_json
                            if delta.get("partial_json"):
                                accumulated_partial_json += delta.get("partial_json")
                                if current_tool_use:
                                    current_tool_use["partial_json"] = accumulated_partial_json

                        elif delta.get("type") == "thinking_delta":
                            accumulated_thinking += delta.get("thinking")

                        elif delta.get("type") == "signature_delta":
                            accumulated_signature += delta.get("signature")

                elif event_type == "content_block_stop":
                    # Content block complete
                    if current_tool_use and accumulated_partial_json:
                        # Parse the accumulated JSON
                        try:
                            arguments_json = json.loads(accumulated_partial_json)
                            arguments = json.dumps(arguments_json)
                        except json.JSONDecodeError:
                            raise RuntimeError(
                                f"Failed to parse tool use input JSON: {accumulated_partial_json}"
                            ) from None

                        tool_call_data = {
                            "call_id": current_tool_use.get("id"),
                            "id": "",
                            "type": "function",
                            "function": {
                                "name": current_tool_use.get("name"),
                                "arguments": arguments,
                            },
                        }
                        tool_calls.append(tool_call_data)
                        yield {
                            "type": "tool_call",
                            "data": {
                                "tool_call": tool_call_data,
                            },
                        }

                        accumulated_content_blocks.append(
                            {
                                "type": "tool_use",
                                "id": current_tool_use.get("id"),
                                "name": current_tool_use.get("name"),
                                "input": json.loads(accumulated_partial_json),
                            }
                        )

                        # Reset tool_use tracking
                        current_tool_use = None
                        accumulated_partial_json = ""

                    elif accumulated_text:
                        accumulated_content_blocks.append(
                            {
                                "type": "text",
                                "text": accumulated_text,
                            }
                        )
                        accumulated_text = ""

                    elif accumulated_thinking:
                        accumulated_content_blocks.append(
                            {
                                "type": "thinking",
                                "thinking": accumulated_thinking,
                                "signature": accumulated_signature,
                            }
                        )
                        accumulated_thinking = ""
                        accumulated_signature = ""

                elif event_type in ["message_start", "message_delta"]:
                    # Message delta - contains stop_reason and usage
                    message = None
                    if event_type == "message_start":
                        message = event.get("message")
                    else:
                        message = event.get("delta")

                    if message:
                        response_model = message.get("model") or response_model  # Update if present
                        stop_reason = message.get("stop_reason") or stop_reason  # Update if present

                        if message.get("usage"):
                            usage_data = message.get("usage")
                            if usage_data:
                                if usage_data.get("input_tokens"):
                                    usage["input_tokens"] = usage_data.get("input_tokens")
                                if usage_data.get("output_tokens"):
                                    usage["output_tokens"] = usage_data.get("output_tokens")

                elif event_type == "message_stop":
                    # Stream complete - final event
                    usage["total_tokens"] = usage.get("input_tokens", 0) + usage.get(
                        "output_tokens", 0
                    )
                    processed_messages.append(
                        {
                            "role": "assistant",
                            "content": accumulated_content_blocks,
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

                elif event_type == "error":
                    # Stream error
                    error_msg = "Stream failed"
                    if event.get("error"):
                        error_obj = event.get("error")
                        if error_obj.get("message"):
                            error_msg = error_obj.get("message")
                        if error_obj.get("type"):
                            error_msg = f"{error_obj.get('type')}: {error_msg}"

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
            raise RuntimeError(f"Anthropic Messages API streaming failed: {str(e)}") from e


def _validate_tools(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """
    Validate and convert tools to Anthropic format.

    Anthropic expects:
    [{
        "name": "...",
        "description": "...",
        "input_schema": {
            "type": "object",
            "properties": {...},
            "required": [...]
        }
    }]
    """
    validated_tools = []
    for tool in tools:
        # Convert OpenAI-style tool format to Anthropic format
        if tool.get("type") == "function" or "type" not in tool:
            # Extract function name, description, and parameters
            function_data = tool.get("function", tool)
            name = function_data.get("name") or tool.get("name")
            description = function_data.get("description") or tool.get("description", "")
            parameters = (
                function_data.get("parameters")
                or tool.get("parameters")
                or tool.get("input_schema")
            )

            if name and parameters:
                # Convert parameters to input_schema (Anthropic format)
                anthropic_tool = {
                    "name": name,
                    "description": description,
                    "input_schema": parameters,  # Anthropic uses input_schema instead of parameters
                }
                validated_tools.append(anthropic_tool)
            else:
                # Missing name or parameters, skip
                import warnings

                warnings.warn(
                    f"Skipping invalid tool (missing name or parameters): {tool}",
                    stacklevel=2,
                )
                continue
        else:
            validated_tools.append(anthropic_tool)

    return validated_tools
