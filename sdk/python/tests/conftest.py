"""Shared pytest configuration and fixtures."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from polos.core.context import AgentContext, WorkflowContext


@pytest.fixture
def mock_workflow_context():
    """Create a mock WorkflowContext for testing."""
    execution_id = str(uuid.uuid4())
    root_execution_id = str(uuid.uuid4())
    return WorkflowContext(
        workflow_id="test-workflow",
        execution_id=execution_id,
        root_execution_id=root_execution_id,
        root_workflow_id="test-workflow",
        deployment_id="test-deployment",
        session_id="test-session",
        user_id="test-user",
    )


@pytest.fixture
def mock_agent_context():
    """Create a mock AgentContext for testing."""
    execution_id = str(uuid.uuid4())
    root_execution_id = str(uuid.uuid4())
    return AgentContext(
        agent_id="test-agent",
        execution_id=execution_id,
        root_execution_id=root_execution_id,
        root_workflow_id="test-agent",
        deployment_id="test-deployment",
        session_id="test-session",
        user_id="test-user",
    )


@pytest.fixture
def mock_http_client():
    """Mock httpx.AsyncClient for API calls."""
    client = AsyncMock()
    client.get = AsyncMock()
    client.post = AsyncMock()
    client.put = AsyncMock()
    client.delete = AsyncMock()
    return client


@pytest.fixture
def mock_tracer():
    """Mock OpenTelemetry tracer."""
    tracer = MagicMock()
    span = MagicMock()
    span.__enter__ = MagicMock(return_value=span)
    span.__exit__ = MagicMock(return_value=False)
    tracer.start_as_current_span = MagicMock(return_value=span)
    return tracer


@pytest.fixture
def mock_openai_client():
    """Mock OpenAI AsyncOpenAI client."""
    client = AsyncMock()
    client.chat.completions.create = AsyncMock()
    return client


@pytest.fixture
def mock_anthropic_client():
    """Mock Anthropic AsyncAnthropic client."""
    client = AsyncMock()
    client.messages.create = AsyncMock()
    client.messages.stream = AsyncMock()
    return client
