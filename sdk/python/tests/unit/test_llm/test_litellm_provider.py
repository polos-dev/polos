"""Unit tests for LiteLLM provider and related alias providers."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from polos.llm.providers.base import LLMResponse, _PROVIDER_REGISTRY, get_provider


class TestLiteLLMProviderRegistration:
    """Tests for LiteLLM provider registration."""

    def test_litellm_provider_registers(self):
        """Test that importing litellm_provider registers it."""
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        assert "litellm" in _PROVIDER_REGISTRY
        assert _PROVIDER_REGISTRY["litellm"] is LiteLLMProvider

    def test_ollama_provider_registers(self):
        """Test that importing ollama registers it."""
        from polos.llm.providers.ollama import OllamaProvider

        assert "ollama" in _PROVIDER_REGISTRY
        assert _PROVIDER_REGISTRY["ollama"] is OllamaProvider

    def test_groq_provider_registers(self):
        """Test that importing groq registers it."""
        from polos.llm.providers.groq import GroqProvider

        assert "groq" in _PROVIDER_REGISTRY
        assert _PROVIDER_REGISTRY["groq"] is GroqProvider

    def test_together_provider_registers(self):
        """Test that importing together registers it."""
        from polos.llm.providers.together import TogetherProvider

        assert "together" in _PROVIDER_REGISTRY
        assert _PROVIDER_REGISTRY["together"] is TogetherProvider

    def test_fireworks_provider_registers(self):
        """Test that importing fireworks registers it."""
        from polos.llm.providers.fireworks import FireworksProvider

        assert "fireworks" in _PROVIDER_REGISTRY
        assert _PROVIDER_REGISTRY["fireworks"] is FireworksProvider

    def test_gemini_provider_registers(self):
        """Test that importing gemini registers it."""
        from polos.llm.providers.gemini import GeminiProvider

        assert "gemini" in _PROVIDER_REGISTRY
        assert _PROVIDER_REGISTRY["gemini"] is GeminiProvider

    def test_azure_provider_registers(self):
        """Test that importing azure registers it."""
        from polos.llm.providers.azure import AzureProvider

        assert "azure" in _PROVIDER_REGISTRY
        assert _PROVIDER_REGISTRY["azure"] is AzureProvider


class TestLiteLLMProviderInit:
    """Tests for LiteLLMProvider initialization."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_init_basic(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        assert provider.api_key is None
        assert provider.api_base is None
        assert provider.provider_prefix is None

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_init_with_params(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider(
            api_key="test-key",
            api_base="http://localhost:8000",
            provider_prefix="groq",
        )
        assert provider.api_key == "test-key"
        assert provider.api_base == "http://localhost:8000"
        assert provider.provider_prefix == "groq"

    def test_init_without_litellm_raises(self):
        """Test that missing litellm package raises ImportError."""
        with patch.dict("sys.modules", {"litellm": None}):
            from importlib import reload

            from polos.llm.providers import litellm_provider

            with pytest.raises(ImportError, match="LiteLLM not installed"):
                reload(litellm_provider)
                litellm_provider.LiteLLMProvider()


class TestResolveModel:
    """Tests for model resolution logic."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_resolve_model_with_prefix(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider(provider_prefix="groq")
        assert provider._resolve_model("llama-3.1-70b") == "groq/llama-3.1-70b"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_resolve_model_already_has_prefix(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider(provider_prefix="groq")
        assert provider._resolve_model("groq/llama-3.1-70b") == "groq/llama-3.1-70b"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_resolve_model_no_prefix(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        assert provider._resolve_model("ollama/llama3") == "ollama/llama3"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_resolve_model_no_prefix_no_slash(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        assert provider._resolve_model("llama3") == "llama3"


class TestConvertTools:
    """Tests for tool format conversion."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_convert_tools_already_openai_format(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get weather",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ]
        result = provider._convert_tools(tools)
        assert result == tools

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_convert_tools_polos_format(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        tools = [
            {
                "type": "function",
                "name": "get_weather",
                "description": "Get weather",
                "parameters": {"type": "object", "properties": {}},
            }
        ]
        result = provider._convert_tools(tools)
        assert len(result) == 1
        assert result[0]["type"] == "function"
        assert result[0]["function"]["name"] == "get_weather"
        assert result[0]["function"]["description"] == "Get weather"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_convert_tools_skips_non_dict(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        tools = ["not_a_dict", {"name": "valid_tool", "type": "function"}]
        result = provider._convert_tools(tools)
        assert len(result) == 1


class TestBuildMessages:
    """Tests for message building."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_build_messages_basic(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = [{"role": "user", "content": "Hello"}]
        result = provider._build_messages(messages, None, None)
        assert result == [{"role": "user", "content": "Hello"}]

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_build_messages_with_system_prompt(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = [{"role": "user", "content": "Hello"}]
        agent_config = {"system_prompt": "You are helpful."}
        result = provider._build_messages(messages, agent_config, None)
        assert len(result) == 2
        assert result[0]["role"] == "system"
        assert result[0]["content"] == "You are helpful."
        assert result[1]["role"] == "user"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_build_messages_with_tool_results(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = [{"role": "user", "content": "Hello"}]
        tool_results = [
            {
                "type": "function_call_output",
                "call_id": "call-123",
                "output": "Result data",
            }
        ]
        result = provider._build_messages(messages, None, tool_results)
        assert len(result) == 2
        assert result[1]["role"] == "tool"
        assert result[1]["tool_call_id"] == "call-123"
        assert result[1]["content"] == "Result data"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_build_messages_with_dict_output(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = []
        tool_results = [
            {
                "type": "function_call_output",
                "call_id": "call-456",
                "output": {"key": "value"},
            }
        ]
        result = provider._build_messages(messages, None, tool_results)
        assert result[0]["content"] == '{"key": "value"}'


class TestConvertHistoryMessages:
    """Tests for session history message conversion."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_passthrough_string_content(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = [{"role": "user", "content": "Hello"}]
        result = provider.convert_history_messages(messages)
        assert result == messages

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_convert_function_call_and_output(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "get_weather",
                        "arguments": '{"city": "SF"}',
                    },
                    {
                        "type": "function_call_output",
                        "call_id": "call-1",
                        "output": "Sunny",
                    },
                ],
            }
        ]
        result = provider.convert_history_messages(messages)
        assert len(result) == 2
        assert result[0]["role"] == "assistant"
        assert len(result[0]["tool_calls"]) == 1
        assert result[0]["tool_calls"][0]["function"]["name"] == "get_weather"
        assert result[1]["role"] == "tool"
        assert result[1]["tool_call_id"] == "call-1"
        assert result[1]["content"] == "Sunny"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_pending_tool_calls_flushed_at_end(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "get_weather",
                        "arguments": "{}",
                    },
                ],
            }
        ]
        result = provider.convert_history_messages(messages)
        assert len(result) == 1
        assert result[0]["role"] == "assistant"
        assert len(result[0]["tool_calls"]) == 1


class TestInjectOutputSchema:
    """Tests for structured output schema injection."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_inject_into_existing_system_message(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = [{"role": "system", "content": "You are helpful."}]
        schema = {"type": "object", "properties": {"name": {"type": "string"}}}
        provider._inject_output_schema(messages, schema)
        assert "IMPORTANT" in messages[0]["content"]
        assert "You are helpful." in messages[0]["content"]

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_inject_creates_system_message(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()
        messages = [{"role": "user", "content": "Hello"}]
        schema = {"type": "object", "properties": {"name": {"type": "string"}}}
        provider._inject_output_schema(messages, schema)
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert "IMPORTANT" in messages[0]["content"]


class TestParseResponse:
    """Tests for response parsing."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_parse_text_response(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()

        mock_message = MagicMock()
        mock_message.content = "Hello world"
        mock_message.tool_calls = None
        mock_message.model_dump.return_value = {"role": "assistant", "content": "Hello world"}

        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_choice.finish_reason = "stop"

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.model = "groq/llama-3.1-70b"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 10
        mock_response.usage.completion_tokens = 20
        mock_response.usage.total_tokens = 30

        result = provider._parse_response(mock_response, "llama-3.1-70b")
        assert isinstance(result, LLMResponse)
        assert result.content == "Hello world"
        assert result.usage["input_tokens"] == 10
        assert result.usage["output_tokens"] == 20
        assert result.model == "groq/llama-3.1-70b"
        assert result.stop_reason == "stop"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_parse_tool_call_response(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()

        mock_tc_func = MagicMock()
        mock_tc_func.name = "get_weather"
        mock_tc_func.arguments = '{"city": "SF"}'

        mock_tc = MagicMock()
        mock_tc.id = "call-123"
        mock_tc.function = mock_tc_func

        mock_message = MagicMock()
        mock_message.content = None
        mock_message.tool_calls = [mock_tc]
        mock_message.model_dump.return_value = {}

        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_choice.finish_reason = "tool_calls"

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.model = "test-model"
        mock_response.usage = None

        result = provider._parse_response(mock_response, "test-model")
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0]["call_id"] == "call-123"
        assert result.tool_calls[0]["function"]["name"] == "get_weather"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_parse_empty_response(self):
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        provider = LiteLLMProvider()

        mock_response = MagicMock()
        mock_response.choices = []
        mock_response.model = None
        mock_response.usage = None

        result = provider._parse_response(mock_response, "fallback-model")
        assert result.content is None
        assert result.tool_calls == []
        assert result.model == "fallback-model"


class TestGenerate:
    """Tests for generate method."""

    @pytest.mark.asyncio
    async def test_generate_basic(self):
        mock_litellm = MagicMock()

        mock_message = MagicMock()
        mock_message.content = "Response text"
        mock_message.tool_calls = None
        mock_message.model_dump.return_value = {"role": "assistant", "content": "Response text"}

        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_choice.finish_reason = "stop"

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.model = "ollama/llama3"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 5
        mock_response.usage.completion_tokens = 10
        mock_response.usage.total_tokens = 15

        mock_litellm.acompletion = AsyncMock(return_value=mock_response)
        mock_litellm.telemetry = True

        with patch.dict("sys.modules", {"litellm": mock_litellm}):
            from importlib import reload

            from polos.llm.providers import litellm_provider

            reload(litellm_provider)

            provider = litellm_provider.LiteLLMProvider(provider_prefix="ollama")
            result = await provider.generate(
                messages=[{"role": "user", "content": "Hi"}],
                model="llama3",
                temperature=0.7,
            )

        assert isinstance(result, LLMResponse)
        assert result.content == "Response text"
        mock_litellm.acompletion.assert_called_once()
        call_kwargs = mock_litellm.acompletion.call_args[1]
        assert call_kwargs["model"] == "ollama/llama3"
        assert call_kwargs["temperature"] == 0.7

    @pytest.mark.asyncio
    async def test_generate_with_tools(self):
        mock_litellm = MagicMock()

        mock_message = MagicMock()
        mock_message.content = None
        mock_message.tool_calls = None
        mock_message.model_dump.return_value = {}

        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_choice.finish_reason = "stop"

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.model = "test"
        mock_response.usage = None

        mock_litellm.acompletion = AsyncMock(return_value=mock_response)
        mock_litellm.telemetry = True

        with patch.dict("sys.modules", {"litellm": mock_litellm}):
            from importlib import reload

            from polos.llm.providers import litellm_provider

            reload(litellm_provider)

            provider = litellm_provider.LiteLLMProvider()
            tools = [
                {
                    "type": "function",
                    "name": "search",
                    "description": "Search the web",
                    "parameters": {"type": "object", "properties": {}},
                }
            ]
            await provider.generate(
                messages=[{"role": "user", "content": "Search for X"}],
                model="ollama/llama3",
                tools=tools,
            )

        call_kwargs = mock_litellm.acompletion.call_args[1]
        assert "tools" in call_kwargs
        assert call_kwargs["tools"][0]["function"]["name"] == "search"


class TestStream:
    """Tests for stream method."""

    @pytest.mark.asyncio
    async def test_stream_text(self):
        mock_litellm = MagicMock()

        # Create mock chunks
        chunk1 = MagicMock()
        chunk1.choices = [MagicMock()]
        chunk1.choices[0].delta = MagicMock()
        chunk1.choices[0].delta.content = "Hello"
        chunk1.choices[0].delta.tool_calls = None
        chunk1.choices[0].finish_reason = None
        chunk1.model = "test-model"
        chunk1.usage = None

        chunk2 = MagicMock()
        chunk2.choices = [MagicMock()]
        chunk2.choices[0].delta = MagicMock()
        chunk2.choices[0].delta.content = " world"
        chunk2.choices[0].delta.tool_calls = None
        chunk2.choices[0].finish_reason = None
        chunk2.model = "test-model"
        chunk2.usage = None

        chunk3 = MagicMock()
        chunk3.choices = [MagicMock()]
        chunk3.choices[0].delta = MagicMock()
        chunk3.choices[0].delta.content = None
        chunk3.choices[0].delta.tool_calls = None
        chunk3.choices[0].finish_reason = "stop"
        chunk3.model = "test-model"
        chunk3.usage = MagicMock()
        chunk3.usage.prompt_tokens = 5
        chunk3.usage.completion_tokens = 2
        chunk3.usage.total_tokens = 7

        async def mock_aiter():
            for chunk in [chunk1, chunk2, chunk3]:
                yield chunk

        mock_litellm.acompletion = AsyncMock(return_value=mock_aiter())
        mock_litellm.telemetry = True

        with patch.dict("sys.modules", {"litellm": mock_litellm}):
            from importlib import reload

            from polos.llm.providers import litellm_provider

            reload(litellm_provider)

            provider = litellm_provider.LiteLLMProvider()
            events = []
            async for event in provider.stream(
                messages=[{"role": "user", "content": "Hi"}],
                model="test-model",
            ):
                events.append(event)

        assert len(events) == 3
        assert events[0]["type"] == "text_delta"
        assert events[0]["data"]["content"] == "Hello"
        assert events[1]["type"] == "text_delta"
        assert events[1]["data"]["content"] == " world"
        assert events[2]["type"] == "done"
        assert events[2]["data"]["stop_reason"] == "stop"


class TestOllamaProvider:
    """Tests for OllamaProvider convenience alias."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_ollama_default_host(self):
        from polos.llm.providers.ollama import OllamaProvider

        with patch.dict("os.environ", {}, clear=True):
            provider = OllamaProvider()
        assert provider.provider_prefix == "ollama"
        assert provider.api_base == "http://localhost:11434"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_ollama_custom_host(self):
        from polos.llm.providers.ollama import OllamaProvider

        provider = OllamaProvider(api_base="http://my-server:11434")
        assert provider.api_base == "http://my-server:11434"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_ollama_env_host(self):
        from polos.llm.providers.ollama import OllamaProvider

        with patch.dict("os.environ", {"OLLAMA_HOST": "http://env-host:11434"}):
            provider = OllamaProvider()
        assert provider.api_base == "http://env-host:11434"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_ollama_model_resolution(self):
        from polos.llm.providers.ollama import OllamaProvider

        provider = OllamaProvider()
        assert provider._resolve_model("llama3") == "ollama/llama3"
        assert provider._resolve_model("ollama/llama3") == "ollama/llama3"


class TestAliasProviders:
    """Tests for migrated alias providers (Groq, Together, Fireworks, Gemini, Azure)."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_groq_requires_api_key(self):
        from polos.llm.providers.groq import GroqProvider

        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(ValueError, match="Groq API key"):
                GroqProvider()

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_groq_with_api_key(self):
        from polos.llm.providers.groq import GroqProvider

        provider = GroqProvider(api_key="test-key")
        assert provider.provider_prefix == "groq"
        assert provider.api_key == "test-key"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_groq_env_api_key(self):
        from polos.llm.providers.groq import GroqProvider

        with patch.dict("os.environ", {"GROQ_API_KEY": "env-key"}):
            provider = GroqProvider()
        assert provider.api_key == "env-key"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_together_requires_api_key(self):
        from polos.llm.providers.together import TogetherProvider

        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(ValueError, match="Together API key"):
                TogetherProvider()

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_together_with_api_key(self):
        from polos.llm.providers.together import TogetherProvider

        provider = TogetherProvider(api_key="test-key")
        assert provider.provider_prefix == "together_ai"
        assert provider.api_key == "test-key"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_fireworks_requires_api_key(self):
        from polos.llm.providers.fireworks import FireworksProvider

        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(ValueError, match="Fireworks API key"):
                FireworksProvider()

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_fireworks_with_api_key(self):
        from polos.llm.providers.fireworks import FireworksProvider

        provider = FireworksProvider(api_key="test-key")
        assert provider.provider_prefix == "fireworks_ai"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_gemini_requires_api_key(self):
        from polos.llm.providers.gemini import GeminiProvider

        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(ValueError, match="Gemini API key"):
                GeminiProvider()

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_gemini_with_api_key(self):
        from polos.llm.providers.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key")
        assert provider.provider_prefix == "gemini"

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_azure_requires_api_key(self):
        from polos.llm.providers.azure import AzureProvider

        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(ValueError, match="Azure OpenAI API key"):
                AzureProvider()

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_azure_with_api_key_and_base_url(self):
        from polos.llm.providers.azure import AzureProvider

        provider = AzureProvider(
            api_key="test-key",
            base_url="https://myresource.openai.azure.com/",
        )
        assert provider.provider_prefix == "azure"
        assert provider.api_base == "https://myresource.openai.azure.com/"


class TestGetProviderIntegration:
    """Tests for get_provider with litellm-backed providers."""

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_get_litellm_provider(self):
        provider = get_provider("litellm")
        from polos.llm.providers.litellm_provider import LiteLLMProvider

        assert isinstance(provider, LiteLLMProvider)

    @patch.dict("sys.modules", {"litellm": MagicMock()})
    def test_get_ollama_provider(self):
        provider = get_provider("ollama")
        from polos.llm.providers.ollama import OllamaProvider

        assert isinstance(provider, OllamaProvider)
