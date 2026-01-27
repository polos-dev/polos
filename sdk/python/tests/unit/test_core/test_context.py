"""Unit tests for polos.core.context module."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from polos.core.context import AgentContext, WorkflowContext


class TestWorkflowContext:
    """Tests for WorkflowContext class."""

    def test_initialization_minimal(self):
        """Test WorkflowContext initialization with minimal parameters."""
        ctx = WorkflowContext(
            workflow_id="test-workflow",
            execution_id=str(uuid.uuid4()),
            deployment_id="test-deployment",
            session_id="test-session",
        )
        assert ctx.workflow_id == "test-workflow"
        assert ctx.deployment_id == "test-deployment"
        assert ctx.session_id == "test-session"
        assert ctx.user_id is None
        assert ctx.parent_execution_id is None
        assert ctx.retry_count == 0
        assert ctx.workflow_type == "workflow"
        assert ctx.state is None
        assert ctx.step is not None

    def test_initialization_full(self):
        """Test WorkflowContext initialization with all parameters."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        parent_execution_id = str(uuid.uuid4())
        created_at = datetime.now()

        ctx = WorkflowContext(
            workflow_id="test-workflow",
            execution_id=execution_id,
            deployment_id="test-deployment",
            session_id="test-session",
            user_id="test-user",
            parent_execution_id=parent_execution_id,
            root_execution_id=root_execution_id,
            retry_count=2,
            created_at=created_at,
            workflow_type="tool",
            otel_traceparent="00-trace-id-span-id-01",
            otel_span_id="span-id",
        )
        assert ctx.workflow_id == "test-workflow"
        assert ctx.execution_id == execution_id
        assert ctx.root_execution_id == root_execution_id
        assert ctx.parent_execution_id == parent_execution_id
        assert ctx.user_id == "test-user"
        assert ctx.retry_count == 2
        assert ctx.created_at == created_at
        assert ctx.workflow_type == "tool"
        assert ctx.otel_traceparent == "00-trace-id-span-id-01"
        assert ctx.otel_span_id == "span-id"

    def test_root_execution_id_defaults_to_execution_id(self):
        """Test that root_execution_id defaults to execution_id if not provided."""
        execution_id = str(uuid.uuid4())
        ctx = WorkflowContext(
            workflow_id="test-workflow",
            execution_id=execution_id,
            deployment_id="test-deployment",
            session_id="test-session",
        )
        assert ctx.root_execution_id == execution_id

    def test_state_schema_initialization_with_initial_state(self):
        """Test state initialization with state_schema and initial_state."""

        class TestState(BaseModel):
            counter: int = 0
            name: str = "default"

        ctx = WorkflowContext(
            workflow_id="test-workflow",
            execution_id=str(uuid.uuid4()),
            deployment_id="test-deployment",
            session_id="test-session",
            state_schema=TestState,
            initial_state={"counter": 5, "name": "test"},
        )
        assert ctx.state is not None
        assert isinstance(ctx.state, TestState)
        assert ctx.state.counter == 5
        assert ctx.state.name == "test"

    def test_state_schema_initialization_without_initial_state(self):
        """Test state initialization with state_schema but no initial_state."""

        class TestState(BaseModel):
            counter: int = 0
            name: str = "default"

        ctx = WorkflowContext(
            workflow_id="test-workflow",
            execution_id=str(uuid.uuid4()),
            deployment_id="test-deployment",
            session_id="test-session",
            state_schema=TestState,
        )
        assert ctx.state is not None
        assert isinstance(ctx.state, TestState)
        assert ctx.state.counter == 0
        assert ctx.state.name == "default"

    def test_to_dict(self):
        """Test to_dict method."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        created_at = datetime.now()

        ctx = WorkflowContext(
            workflow_id="test-workflow",
            execution_id=execution_id,
            deployment_id="test-deployment",
            session_id="test-session",
            user_id="test-user",
            root_execution_id=root_execution_id,
            retry_count=1,
            created_at=created_at,
        )
        result = ctx.to_dict()
        assert result["workflow_id"] == "test-workflow"
        assert result["execution_id"] == execution_id
        assert result["deployment_id"] == "test-deployment"
        assert result["session_id"] == "test-session"
        assert result["user_id"] == "test-user"
        assert result["root_execution_id"] == root_execution_id
        assert result["retry_count"] == 1
        assert result["created_at"] == created_at.isoformat()

    def test_to_dict_with_none_created_at(self):
        """Test to_dict with None created_at."""
        ctx = WorkflowContext(
            workflow_id="test-workflow",
            execution_id=str(uuid.uuid4()),
            deployment_id="test-deployment",
            session_id="test-session",
        )
        result = ctx.to_dict()
        assert result["created_at"] is None


class TestAgentContext:
    """Tests for AgentContext class."""

    def test_initialization_minimal(self):
        """Test AgentContext initialization with minimal parameters."""
        ctx = AgentContext(
            agent_id="test-agent",
            execution_id=str(uuid.uuid4()),
            deployment_id="test-deployment",
        )
        assert ctx.agent_id == "test-agent"
        assert ctx.workflow_id == "test-agent"  # Inherited from parent
        assert ctx.workflow_type == "agent"
        assert ctx.model == "gpt-4"
        assert ctx.provider == "openai"
        assert ctx.system_prompt is None
        assert ctx.tools == []
        assert ctx.temperature is None
        assert ctx.max_tokens is None
        assert ctx.conversation_id is None

    def test_initialization_full(self):
        """Test AgentContext initialization with all parameters."""
        execution_id = str(uuid.uuid4())
        root_execution_id = str(uuid.uuid4())
        created_at = datetime.now()

        ctx = AgentContext(
            agent_id="test-agent",
            execution_id=execution_id,
            deployment_id="test-deployment",
            root_execution_id=root_execution_id,
            retry_count=1,
            model="gpt-3.5-turbo",
            provider="anthropic",
            system_prompt="You are a helpful assistant",
            tools=["tool1", "tool2"],
            temperature=0.7,
            max_tokens=1000,
            session_id="test-session",
            conversation_id="test-conversation",
            user_id="test-user",
            created_at=created_at,
        )
        assert ctx.agent_id == "test-agent"
        assert ctx.model == "gpt-3.5-turbo"
        assert ctx.provider == "anthropic"
        assert ctx.system_prompt == "You are a helpful assistant"
        assert ctx.tools == ["tool1", "tool2"]
        assert ctx.temperature == 0.7
        assert ctx.max_tokens == 1000
        assert ctx.conversation_id == "test-conversation"
        assert ctx.session_id == "test-session"
        assert ctx.user_id == "test-user"
        assert ctx.created_at == created_at

    def test_tools_defaults_to_empty_list(self):
        """Test that tools defaults to empty list if None."""
        ctx = AgentContext(
            agent_id="test-agent",
            execution_id=str(uuid.uuid4()),
            deployment_id="test-deployment",
            tools=None,
        )
        assert ctx.tools == []

    def test_to_dict_includes_agent_fields(self):
        """Test that to_dict includes agent-specific fields."""
        ctx = AgentContext(
            agent_id="test-agent",
            execution_id=str(uuid.uuid4()),
            deployment_id="test-deployment",
            model="gpt-3.5-turbo",
            provider="anthropic",
            system_prompt="Test prompt",
            tools=["tool1"],
            temperature=0.7,
            max_tokens=1000,
        )
        result = ctx.to_dict()
        assert result["model"] == "gpt-3.5-turbo"
        assert result["provider"] == "anthropic"
        assert result["system_prompt"] == "Test prompt"
        assert result["tools"] == ["tool1"]
        assert result["temperature"] == 0.7
        assert result["max_tokens"] == 1000
        # Should also include parent fields
        assert "workflow_id" in result
        assert "execution_id" in result

    def test_inherits_from_workflow_context(self):
        """Test that AgentContext inherits WorkflowContext functionality."""
        ctx = AgentContext(
            agent_id="test-agent",
            execution_id=str(uuid.uuid4()),
            deployment_id="test-deployment",
            session_id="test-session",
            state_schema=None,
        )
        # Should have step helper from parent
        assert ctx.step is not None
        # Should have to_dict from parent (with agent fields added)
        result = ctx.to_dict()
        assert "workflow_id" in result
        assert "model" in result
