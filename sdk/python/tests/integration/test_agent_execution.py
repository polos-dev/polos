"""Integration tests for agent execution."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from polos import Agent, AgentContext, WorkflowContext
from polos.core.step import Step
from polos.core.workflow import _execution_context
from polos.llm.providers.base import LLMResponse
from polos.runtime.client import PolosClient
from polos.types.types import AgentResult


class TestAgentExecution:
    """Integration tests for agent execution."""

    @pytest.mark.asyncio
    async def test_agent_basic_execution(self):
        """Test basic agent execution with mocked LLM."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        # Mock LLM provider first, before creating Agent
        mock_provider = MagicMock()
        mock_response = LLMResponse(
            content="Hello, world!",
            usage={"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
            raw_output=[{"role": "assistant", "content": "Hello, world!"}],
        )
        mock_provider.generate = AsyncMock(return_value=mock_response)

        # Mock the import before creating Agent
        import os
        import sys

        mock_openai = MagicMock()
        mock_openai.AsyncOpenAI = MagicMock()
        sys.modules["openai"] = mock_openai

        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "POLOS_API_KEY": "test-key"}),
            patch("polos.llm.providers.get_provider", return_value=mock_provider),
            patch("polos.llm.generate.get_provider", return_value=mock_provider),
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
            patch(
                "polos.core.step.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.features.wait.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch("polos.features.events.publish", new_callable=AsyncMock),
            patch("polos.features.events.batch_publish", new_callable=AsyncMock, return_value=[]),
            patch("polos.core.step.batch_publish", new_callable=AsyncMock, return_value=[]),
            patch(
                "polos.runtime.client.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.features.tracing.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.llm.stream.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.agents.stream.get_session_memory",
                new_callable=AsyncMock,
                return_value={"summary": None, "messages": []},
            ),
            patch(
                "polos.agents.stream.put_session_memory",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch("polos.utils.tracing.set_span_context_in_execution_context") as mock_set_span,
        ):
            # Mock set_span_context to handle None span_context
            def safe_set_span_context(exec_context, span_context):
                if exec_context and span_context:
                    exec_context["_otel_span_context"] = span_context
                    exec_context["_otel_trace_id"] = format(span_context.trace_id, "032x")
                    exec_context["_otel_span_id"] = format(span_context.span_id, "016x")
                elif exec_context:
                    exec_context["_otel_span_context"] = None

            mock_set_span.side_effect = safe_set_span_context
            # Create a simple agent
            agent = Agent(
                id="test-agent",
                provider="openai",
                model="gpt-5",
                system_prompt="You are a helpful assistant",
            )
            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = AgentContext(
                    agent_id="test-agent",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    root_workflow_id="test-agent",
                    deployment_id="test-deployment",
                    session_id="test-session",
                )

                # Execute agent function
                payload = {
                    "agent_run_id": execution_id,
                    "agent_config": {
                        "provider": "openai",
                        "model": "gpt-5",
                        "system_prompt": "You are a helpful assistant",
                    },
                    "input": "Hello",
                    "streaming": False,
                }

                result = await agent._agent_execute(ctx, payload)

                # result is an AgentResult object
                assert isinstance(result, AgentResult)
                assert result.agent_run_id == execution_id
                assert result.result == "Hello, world!"
                assert result.total_steps == 1
                mock_provider.generate.assert_called()
            finally:
                _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_agent_with_tool_calling(self):
        """Test agent execution with tool calling."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        # Define a tool (using proper signature)
        from pydantic import BaseModel

        from polos import tool

        class AddInput(BaseModel):
            a: int
            b: int

        @tool
        def add_numbers(ctx: WorkflowContext, input: AddInput) -> int:
            """Add two numbers."""
            return input.a + input.b

        # Create agent with tool
        agent = Agent(
            id="test-agent-tools",
            provider="openai",
            model="gpt-5",
            tools=[add_numbers],
        )

        # Mock LLM provider with tool call
        mock_provider = MagicMock()
        mock_provider.generate = AsyncMock(
            return_value=LLMResponse(
                content=None,
                tool_calls=[
                    {
                        "id": "call-1",
                        "call_id": "call-1",  # Add call_id for tool_call_call_id
                        "function": {"name": "add_numbers", "arguments": '{"a": 2, "b": 3}'},
                    }
                ],
                usage={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
                raw_output=[
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "call_id": "call-1",
                                "function": {
                                    "name": "add_numbers",
                                    "arguments": '{"a": 2, "b": 3}',
                                },
                            }
                        ],
                    }
                ],
            )
        )

        # Mock the import before creating Agent
        import os
        import sys

        mock_openai = MagicMock()
        mock_openai.AsyncOpenAI = MagicMock()
        sys.modules["openai"] = mock_openai

        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "POLOS_API_KEY": "test-key"}),
            patch("polos.llm.providers.get_provider", return_value=mock_provider),
            patch("polos.llm.generate.get_provider", return_value=mock_provider),
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
            patch(
                "polos.core.step.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.features.wait.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch("polos.features.events.publish", new_callable=AsyncMock),
            patch(
                "polos.runtime.client.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.features.tracing.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.llm.stream.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.agents.stream.get_session_memory",
                new_callable=AsyncMock,
                return_value={"summary": None, "messages": []},
            ),
            patch(
                "polos.agents.stream.put_session_memory",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch("polos.features.events.batch_publish", new_callable=AsyncMock, return_value=[]),
            patch("polos.core.step.batch_publish", new_callable=AsyncMock, return_value=[]),
            patch.object(
                Step, "batch_invoke_and_wait", new_callable=AsyncMock
            ) as mock_batch_invoke,
        ):
            from polos.types.types import BatchStepResult

            mock_batch_invoke.return_value = [
                BatchStepResult(
                    workflow_id="add_numbers",
                    success=True,
                    result=5,
                    error=None,
                )
            ]

            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = AgentContext(
                    agent_id="test-agent-tools",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    root_workflow_id="test-agent-tools",
                    deployment_id="test-deployment",
                    session_id="test-session",
                )

                payload = {
                    "agent_run_id": execution_id,
                    "agent_config": {
                        "provider": "openai",
                        "model": "gpt-5",
                        "tools": [{"name": "add_numbers", "description": "Add two numbers"}],
                    },
                    "input": "Add 2 and 3",
                    "streaming": False,
                }

                result = await agent._agent_execute(ctx, payload)

                # Tool should be executed
                mock_batch_invoke.assert_called()
                assert isinstance(result, AgentResult)
                assert result.agent_run_id == execution_id
            finally:
                _execution_context.set(None)

    @pytest.mark.asyncio
    async def test_agent_with_stop_condition(self):
        """Test agent execution with stop conditions."""
        from polos import MaxStepsConfig, max_steps

        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())

        agent = Agent(
            id="test-agent-stop",
            provider="openai",
            model="gpt-5",
            stop_conditions=[max_steps(MaxStepsConfig(count=2))],
        )

        # Mock LLM provider
        mock_provider = MagicMock()
        mock_provider.generate = AsyncMock(
            return_value=LLMResponse(
                content="Response",
                usage={"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
                raw_output=[{"role": "assistant", "content": "Response"}],
            )
        )

        # Mock the import before creating Agent
        import os
        import sys

        mock_openai = MagicMock()
        mock_openai.AsyncOpenAI = MagicMock()
        sys.modules["openai"] = mock_openai

        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "POLOS_API_KEY": "test-key"}),
            patch("polos.llm.providers.get_provider", return_value=mock_provider),
            patch("polos.llm.generate.get_provider", return_value=mock_provider),
            patch("polos.core.step.get_step_output", new_callable=AsyncMock, return_value=None),
            patch("polos.core.step.store_step_output", new_callable=AsyncMock),
            patch(
                "polos.core.step.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.features.wait.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch("polos.features.events.publish", new_callable=AsyncMock),
            patch("polos.features.events.batch_publish", new_callable=AsyncMock, return_value=[]),
            patch("polos.core.step.batch_publish", new_callable=AsyncMock, return_value=[]),
            patch(
                "polos.runtime.client.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.features.tracing.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.llm.stream.get_client_or_raise",
                return_value=PolosClient(
                    api_url="http://localhost:8080", api_key="test-key", project_id="test-project"
                ),
            ),
            patch(
                "polos.agents.stream.get_session_memory",
                new_callable=AsyncMock,
                return_value={"summary": None, "messages": []},
            ),
            patch(
                "polos.agents.stream.put_session_memory",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch("polos.utils.tracing.set_span_context_in_execution_context") as mock_set_span,
        ):
            # Mock set_span_context to handle None span_context
            def safe_set_span_context(exec_context, span_context):
                if exec_context and span_context:
                    exec_context["_otel_span_context"] = span_context
                    exec_context["_otel_trace_id"] = format(span_context.trace_id, "032x")
                    exec_context["_otel_span_id"] = format(span_context.span_id, "016x")
                elif exec_context:
                    exec_context["_otel_span_context"] = None

            mock_set_span.side_effect = safe_set_span_context

            _execution_context.set(
                {
                    "execution_id": execution_id,
                    "root_execution_id": root_execution_id,
                }
            )

            try:
                ctx = AgentContext(
                    agent_id="test-agent-stop",
                    execution_id=execution_id,
                    root_execution_id=root_execution_id,
                    root_workflow_id="test-agent-stop",
                    deployment_id="test-deployment",
                    session_id="test-session",
                )

                payload = {
                    "agent_run_id": execution_id,
                    "agent_config": {
                        "provider": "openai",
                        "model": "gpt-5",
                    },
                    "input": "Hello",
                    "streaming": False,
                }

                # The agent execution should respect stop conditions
                # This is tested through the agent stream function
                result = await agent._agent_execute(ctx, payload)

                assert isinstance(result, AgentResult)
                assert result.agent_run_id == execution_id
            finally:
                _execution_context.set(None)
