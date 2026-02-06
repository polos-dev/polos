"""Unit tests for polos.agents.agent module."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from polos.agents.agent import (
    Agent,
    AgentRunConfig,
    AgentStreamHandle,
    FullEventIterator,
    StreamResult,
    TextChunkIterator,
)
from polos.runtime.client import ExecutionHandle, PolosClient


class TestAgentRunConfig:
    """Tests for AgentRunConfig class."""

    def test_agent_run_config_initialization(self):
        """Test AgentRunConfig initialization."""
        mock_agent = MagicMock(spec=Agent)
        config = AgentRunConfig(
            agent=mock_agent,
            input="Hello",
            session_id="test-session",
            conversation_id="test-conversation",
            user_id="test-user",
        )
        assert config.agent == mock_agent
        assert config.input == "Hello"
        assert config.session_id == "test-session"
        assert config.conversation_id == "test-conversation"
        assert config.user_id == "test-user"
        assert config.streaming is False
        assert config.initial_state is None

    def test_agent_run_config_with_streaming(self):
        """Test AgentRunConfig with streaming enabled."""
        mock_agent = MagicMock(spec=Agent)
        config = AgentRunConfig(agent=mock_agent, input="Hello", streaming=True)
        assert config.streaming is True

    def test_agent_run_config_with_initial_state(self):
        """Test AgentRunConfig with initial_state."""
        from pydantic import BaseModel

        class TestState(BaseModel):
            counter: int = 0

        mock_agent = MagicMock(spec=Agent)
        state = TestState(counter=5)
        config = AgentRunConfig(agent=mock_agent, input="Hello", initial_state=state)
        assert config.initial_state == state

    def test_agent_run_config_with_kwargs(self):
        """Test AgentRunConfig with additional kwargs."""
        mock_agent = MagicMock(spec=Agent)
        config = AgentRunConfig(agent=mock_agent, input="Hello", custom_param="value")
        assert config.kwargs["custom_param"] == "value"


class TestStreamResult:
    """Tests for StreamResult class."""

    def test_stream_result_initialization(self):
        """Test StreamResult initialization."""
        execution_id = str(uuid.uuid4())
        handle = ExecutionHandle(
            id=execution_id,
            workflow_id="test-agent",
            root_workflow_id="test-agent",
            root_execution_id=None,
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        result = StreamResult(handle, client)
        assert result.handle == handle
        assert result.agent_run_id == execution_id
        assert result.id == execution_id

    def test_stream_result_sets_root_execution_id(self):
        """Test StreamResult sets root_execution_id if None."""
        execution_id = str(uuid.uuid4())
        handle = ExecutionHandle(
            id=execution_id,
            workflow_id="test-agent",
            root_workflow_id="test-agent",
            root_execution_id=None,
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        result = StreamResult(handle, client)
        assert result.root_execution_id == execution_id
        assert handle.root_execution_id == execution_id

    def test_stream_result_topic(self):
        """Test StreamResult topic property."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        handle = ExecutionHandle(
            id=execution_id,
            workflow_id="test-agent",
            root_workflow_id="test-agent",
            root_execution_id=root_execution_id,
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        result = StreamResult(handle, client)
        assert result.topic == f"workflow/test-agent/{root_execution_id}"

    def test_stream_result_delegates_to_handle(self):
        """Test StreamResult delegates properties to handle."""
        execution_id = str(uuid.uuid4())
        handle = ExecutionHandle(
            id=execution_id,
            workflow_id="test-agent",
            root_workflow_id="test-agent",
            session_id="test-session",
            user_id="test-user",
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        result = StreamResult(handle, client)
        assert result.workflow_id == "test-agent"
        assert result.session_id == "test-session"
        assert result.user_id == "test-user"

    @pytest.mark.asyncio
    async def test_stream_result_get(self):
        """Test StreamResult.get method."""
        handle = ExecutionHandle(
            id=str(uuid.uuid4()), workflow_id="test-agent", root_workflow_id="test-agent"
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        with patch.object(
            ExecutionHandle, "get", new_callable=AsyncMock, return_value={"status": "running"}
        ):
            result = StreamResult(handle, client)
            status = await result.get()
            assert status == {"status": "running"}

    def test_stream_result_to_dict(self):
        """Test StreamResult.to_dict method."""
        handle = ExecutionHandle(
            id=str(uuid.uuid4()), workflow_id="test-agent", root_workflow_id="test-agent"
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        result = StreamResult(handle, client)
        data = result.to_dict()
        # to_dict() calls model_dump() on the ExecutionHandle
        assert data["id"] == handle.id
        assert data["workflow_id"] == "test-agent"

    def test_stream_result_repr(self):
        """Test StreamResult.__repr__ method."""
        execution_id = str(uuid.uuid4())
        handle = ExecutionHandle(
            id=execution_id,
            workflow_id="test-agent",
            root_workflow_id="test-agent",
            root_execution_id=execution_id,
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        result = StreamResult(handle, client)
        repr_str = repr(result)
        assert "StreamResult" in repr_str
        assert execution_id in repr_str

    def test_stream_result_text_chunks_property(self):
        """Test StreamResult.text_chunks property."""
        handle = ExecutionHandle(
            id=str(uuid.uuid4()), workflow_id="test-agent", root_workflow_id="test-agent"
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        result = StreamResult(handle, client)
        assert isinstance(result.text_chunks, TextChunkIterator)

    def test_stream_result_events_property(self):
        """Test StreamResult.events property."""
        handle = ExecutionHandle(
            id=str(uuid.uuid4()), workflow_id="test-agent", root_workflow_id="test-agent"
        )
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        result = StreamResult(handle, client)
        assert isinstance(result.events, FullEventIterator)


class TestAgentStreamHandle:
    """Tests for AgentStreamHandle class."""

    def test_agent_stream_handle_initialization(self):
        """Test AgentStreamHandle initialization."""
        agent_run_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        handle = AgentStreamHandle(client, agent_run_id, "test-agent", root_execution_id)
        assert handle.agent_run_id == agent_run_id
        assert handle.topic == f"workflow/test-agent/{root_execution_id}"
        assert handle.last_valid_event_id is None
        assert handle.created_at is None

    def test_agent_stream_handle_topic_fallback(self):
        """Test AgentStreamHandle topic falls back to agent_run_id."""
        agent_run_id = str(uuid.uuid4())
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        handle = AgentStreamHandle(client, agent_run_id, "test-agent", None)
        assert handle.topic == f"workflow/test-agent/{agent_run_id}"

    @pytest.mark.asyncio
    async def test_agent_stream_handle_iteration(self):
        """Test AgentStreamHandle async iteration."""
        from polos.features.events import StreamEvent

        agent_run_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        handle = AgentStreamHandle(client, agent_run_id, "test-agent", root_execution_id)

        # Mock stream_workflow - it returns StreamEvent objects
        mock_events = [
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=1,
                topic=f"workflow:{root_execution_id}",
                event_type="text_delta",
                data={"content": "Hello"},
            ),
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=2,
                topic=f"workflow:{root_execution_id}",
                event_type="text_delta",
                data={"content": " World"},
            ),
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=3,
                topic=f"workflow:{root_execution_id}",
                event_type="agent_finish",
                data={"_metadata": {"execution_id": agent_run_id}},
            ),
        ]

        with patch("polos.features.events.stream_workflow") as mock_stream:

            async def async_iter():
                for event in mock_events:
                    yield event

            mock_stream.return_value = async_iter()

            events = []
            async for event in handle:
                events.append(event)
                if event.event_type == "agent_finish":
                    break

            assert len(events) == 3
            assert events[0].event_type == "text_delta"
            assert events[2].event_type == "agent_finish"


class TestTextChunkIterator:
    """Tests for TextChunkIterator class."""

    @pytest.mark.asyncio
    async def test_text_chunk_iterator(self):
        """Test TextChunkIterator yields text chunks."""
        from polos.features.events import StreamEvent

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        handle = StreamResult(
            ExecutionHandle(
                id=execution_id,
                workflow_id="test-agent",
                root_execution_id=root_execution_id,
            ),
            client,
        )

        # Mock events - TextChunkIterator uses AgentStreamHandle internally
        mock_events = [
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=1,
                topic=f"workflow:{root_execution_id}",
                event_type="text_delta",
                data={"content": "Hello"},
            ),
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=2,
                topic=f"workflow:{root_execution_id}",
                event_type="text_delta",
                data={"content": " World"},
            ),
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=3,
                topic=f"workflow:{root_execution_id}",
                event_type="agent_finish",
                data={"_metadata": {"execution_id": execution_id}},
            ),
        ]

        with patch("polos.features.events.stream_workflow") as mock_stream:

            async def async_iter():
                for event in mock_events:
                    yield event

            mock_stream.return_value = async_iter()

            iterator = TextChunkIterator(handle)
            chunks = []
            async for chunk in iterator:
                chunks.append(chunk)

            assert chunks == ["Hello", " World"]


class TestFullEventIterator:
    """Tests for FullEventIterator class."""

    @pytest.mark.asyncio
    async def test_full_event_iterator(self):
        """Test FullEventIterator yields all events."""
        from polos.features.events import StreamEvent

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        handle = StreamResult(
            ExecutionHandle(
                id=execution_id,
                workflow_id="test-agent",
                root_execution_id=root_execution_id,
            ),
            client,
        )

        # Mock events - FullEventIterator uses AgentStreamHandle internally
        mock_events = [
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=1,
                topic=f"workflow:{root_execution_id}",
                event_type="text_delta",
                data={"content": "Hello"},
            ),
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=2,
                topic=f"workflow:{root_execution_id}",
                event_type="tool_call",
                data={"tool": "test_tool"},
            ),
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=3,
                topic=f"workflow:{root_execution_id}",
                event_type="agent_finish",
                data={"_metadata": {"execution_id": execution_id}},
            ),
        ]

        with patch("polos.features.events.stream_workflow") as mock_stream:

            async def async_iter():
                for event in mock_events:
                    yield event

            mock_stream.return_value = async_iter()

            iterator = FullEventIterator(handle)
            events = []
            async for event in iterator:
                events.append(event)
                if event.event_type == "agent_finish":
                    break

            assert len(events) == 3
            assert events[0].event_type == "text_delta"
            assert events[1].event_type == "tool_call"
            assert events[2].event_type == "agent_finish"


class TestStreamResultMethods:
    """Tests for StreamResult methods."""

    @pytest.mark.asyncio
    async def test_stream_result_text(self):
        """Test StreamResult.text() method."""
        from polos.features.events import StreamEvent

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        handle = StreamResult(
            ExecutionHandle(
                id=execution_id,
                workflow_id="test-agent",
                root_execution_id=root_execution_id,
            ),
            client,
        )

        mock_events = [
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=1,
                topic=f"workflow:{root_execution_id}",
                event_type="text_delta",
                data={"content": "Hello"},
            ),
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=2,
                topic=f"workflow:{root_execution_id}",
                event_type="text_delta",
                data={"content": " World"},
            ),
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=3,
                topic=f"workflow:{root_execution_id}",
                event_type="agent_finish",
                data={"_metadata": {"execution_id": execution_id}},
            ),
        ]

        with patch("polos.features.events.stream_workflow") as mock_stream:

            async def async_iter():
                for event in mock_events:
                    yield event

            mock_stream.return_value = async_iter()

            text = await handle.text()
            assert text == "Hello World"

    @pytest.mark.asyncio
    async def test_stream_result_result(self):
        """Test StreamResult.result() method."""
        from polos.features.events import StreamEvent
        from polos.types.types import AgentResult, Usage

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        client = PolosClient(api_url="http://localhost:8080", api_key="test", project_id="test")
        handle = StreamResult(
            ExecutionHandle(
                id=execution_id,
                workflow_id="test-agent",
                root_execution_id=root_execution_id,
            ),
            client,
        )

        result_data = {
            "agent_run_id": execution_id,
            "result": "Test result",
            "tool_results": [],
            "total_steps": 1,
            "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
        }

        mock_events = [
            StreamEvent(
                id=str(uuid.uuid4()),
                sequence_id=1,
                topic=f"workflow:{root_execution_id}",
                event_type="agent_finish",
                data={"_metadata": {"execution_id": root_execution_id}, "result": result_data},
            ),
        ]

        with (
            patch("polos.features.events.stream_workflow") as mock_stream,
            patch("polos.agents.agent.deserialize_agent_result") as mock_deserialize,
        ):
            mock_result = AgentResult(
                agent_run_id=execution_id,
                result="Test result",
                tool_results=[],
                total_steps=1,
                usage=Usage(input_tokens=10, output_tokens=20),
            )
            mock_deserialize.return_value = mock_result

            async def async_iter():
                for event in mock_events:
                    yield event

            mock_stream.return_value = async_iter()

            result = await handle.result()
            assert isinstance(result, AgentResult)
            assert result.agent_run_id == execution_id


class TestAgent:
    """Tests for Agent class."""

    def test_agent_initialization(self):
        """Test Agent initialization."""
        agent = Agent(
            id="test-agent",
            model="gpt-4",
            provider="openai",
        )
        assert agent.id == "test-agent"
        assert agent.workflow_type == "agent"
        assert agent.model == "gpt-4"
        assert agent.provider == "openai"

    def test_agent_inherits_from_workflow(self):
        """Test that Agent inherits from Workflow."""
        agent = Agent(id="test-agent", model="gpt-4", provider="openai")
        # Should have Workflow properties
        assert hasattr(agent, "func")  # func is _agent_execute
        assert hasattr(agent, "is_async")
        assert agent.workflow_type == "agent"

    def test_agent_with_tools(self):
        """Test Agent initialization with tools."""
        tools = [{"name": "test_tool", "description": "A test tool"}]
        agent = Agent(id="test-agent", model="gpt-4", provider="openai", tools=tools)
        assert agent.tools == tools

    def test_agent_with_stop_conditions(self):
        """Test Agent initialization with stop conditions."""
        from polos.agents.stop_conditions import MaxStepsConfig, max_steps

        stop_conditions = [max_steps(MaxStepsConfig(count=5))]
        agent = Agent(
            id="test-agent",
            model="gpt-4",
            provider="openai",
            stop_conditions=stop_conditions,
        )
        assert agent.stop_conditions == stop_conditions

    def test_agent_with_guardrails(self):
        """Test Agent initialization with guardrails."""

        def guardrail_func(ctx, guardrail_ctx):
            from polos.middleware.guardrail import GuardrailResult

            return GuardrailResult.continue_with()

        agent = Agent(
            id="test-agent",
            model="gpt-4",
            provider="openai",
            guardrails=[guardrail_func],
        )
        assert len(agent.guardrails) == 1

    def test_agent_with_conversation_history(self):
        """Test Agent initialization with conversation_history."""
        agent = Agent(
            id="test-agent",
            model="gpt-4",
            provider="openai",
            conversation_history=20,
        )
        assert agent.conversation_history == 20

    def test_agent_invalid_stop_condition_raises(self):
        """Test Agent initialization with invalid stop condition raises TypeError."""
        with pytest.raises(TypeError, match="Invalid stop_condition"):
            Agent(
                id="test-agent",
                model="gpt-4",
                provider="openai",
                stop_conditions=["not a callable"],
            )

    def test_agent_normalize_guardrails(self):
        """Test Agent._normalize_guardrails method."""

        def guardrail1(ctx, guardrail_ctx):
            from polos.middleware.guardrail import GuardrailResult

            return GuardrailResult.continue_with()

        def guardrail2(ctx, guardrail_ctx):
            from polos.middleware.guardrail import GuardrailResult

            return GuardrailResult.continue_with()

        agent = Agent(id="test-agent", model="gpt-4", provider="openai")
        # Test with single callable
        result = agent._normalize_guardrails(guardrail1)
        assert len(result) == 1
        assert result[0] == guardrail1

        # Test with list
        result = agent._normalize_guardrails([guardrail1, guardrail2])
        assert len(result) == 2

        # Test with None
        result = agent._normalize_guardrails(None)
        assert result == []

        # Test with string (workflow ID)
        result = agent._normalize_guardrails("other-workflow")
        assert result == ["other-workflow"]

        # Test with invalid type
        with pytest.raises(TypeError, match="Invalid guardrails type"):
            agent._normalize_guardrails(123)  # type: ignore
