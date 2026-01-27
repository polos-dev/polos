"""Unit tests for polos.agents.stop_conditions module."""

import pytest
from pydantic import BaseModel

from polos.agents.stop_conditions import (
    ExecutedToolConfig,
    HasTextConfig,
    MaxStepsConfig,
    MaxTokensConfig,
    StopConditionContext,
    executed_tool,
    has_text,
    max_steps,
    max_tokens,
    stop_condition,
)
from polos.types.types import Step, ToolCall, ToolCallFunction, Usage


class TestStopConditionContext:
    """Tests for StopConditionContext class."""

    def test_stop_condition_context_initialization(self):
        """Test StopConditionContext initialization."""
        ctx = StopConditionContext()
        assert ctx.steps == []
        assert ctx.agent_id is None
        assert ctx.agent_run_id is None

    def test_stop_condition_context_full_initialization(self):
        """Test StopConditionContext initialization with all fields."""
        steps = [Step(step=1, content="test")]
        ctx = StopConditionContext(steps=steps, agent_id="test-agent", agent_run_id="test-run")
        assert ctx.steps == steps
        assert ctx.agent_id == "test-agent"
        assert ctx.agent_run_id == "test-run"

    def test_stop_condition_context_to_dict(self):
        """Test StopConditionContext.to_dict method."""
        ctx = StopConditionContext(agent_id="test-agent", agent_run_id="test-run")
        result = ctx.to_dict()
        assert isinstance(result, dict)
        assert result["agent_id"] == "test-agent"
        assert result["agent_run_id"] == "test-run"

    def test_stop_condition_context_from_dict(self):
        """Test StopConditionContext.from_dict method."""
        data = {
            "agent_id": "test-agent",
            "agent_run_id": "test-run",
            "steps": [],
        }
        ctx = StopConditionContext.from_dict(data)
        assert ctx.agent_id == "test-agent"
        assert ctx.agent_run_id == "test-run"

    def test_stop_condition_context_from_dict_with_instance(self):
        """Test StopConditionContext.from_dict with StopConditionContext instance."""
        original = StopConditionContext(agent_id="test-agent")
        result = StopConditionContext.from_dict(original)
        assert result == original

    def test_stop_condition_context_from_dict_invalid_type(self):
        """Test StopConditionContext.from_dict with invalid type raises TypeError."""
        with pytest.raises(TypeError, match="Cannot create StopConditionContext"):
            StopConditionContext.from_dict("not a dict or StopConditionContext")


class TestStopConditionDecorator:
    """Tests for @stop_condition decorator."""

    def test_stop_condition_simple(self):
        """Test @stop_condition decorator with simple function."""

        @stop_condition
        async def simple_stop(ctx: StopConditionContext) -> bool:
            return True

        # Should not raise and function should be callable
        assert callable(simple_stop)

    def test_stop_condition_with_config(self):
        """Test @stop_condition decorator with config parameter."""

        class TestConfig(BaseModel):
            limit: int

        @stop_condition
        async def config_stop(ctx: StopConditionContext, config: TestConfig) -> bool:
            return len(ctx.steps) >= config.limit

        # Should not raise
        assert callable(config_stop)

        # Should return configured callable when called with config
        configured = config_stop(TestConfig(limit=5))
        assert callable(configured)

    def test_stop_condition_invalid_first_parameter(self):
        """Test @stop_condition decorator with invalid first parameter raises TypeError."""
        with pytest.raises(
            TypeError, match="first parameter must be typed as 'StopConditionContext'"
        ):

            @stop_condition
            def invalid_stop(ctx: str) -> bool:
                return True

    def test_stop_condition_invalid_config_type(self):
        """Test @stop_condition decorator with non-Pydantic config raises TypeError."""
        with pytest.raises(TypeError, match="must be a Pydantic BaseModel class"):

            @stop_condition
            def invalid_config_stop(ctx: StopConditionContext, config: str) -> bool:
                return True

    def test_stop_condition_config_with_dict(self):
        """Test @stop_condition decorator config accepts dict."""

        class TestConfig(BaseModel):
            limit: int

        @stop_condition
        async def config_stop(ctx: StopConditionContext, config: TestConfig) -> bool:
            return len(ctx.steps) >= config.limit

        # Should accept dict
        configured = config_stop({"limit": 5})
        assert callable(configured)

    def test_stop_condition_config_with_kwargs(self):
        """Test @stop_condition decorator config accepts kwargs."""

        class TestConfig(BaseModel):
            limit: int

        @stop_condition
        async def config_stop(ctx: StopConditionContext, config: TestConfig) -> bool:
            return len(ctx.steps) >= config.limit

        # Should accept kwargs
        configured = config_stop(limit=5)
        assert callable(configured)


class TestMaxTokensStopCondition:
    """Tests for max_tokens stop condition."""

    @pytest.mark.asyncio
    async def test_max_tokens_stops_when_limit_reached(self):
        """Test max_tokens stops when token limit is reached."""
        config = MaxTokensConfig(limit=100)
        ctx = StopConditionContext(
            steps=[
                Step(step=1, usage=Usage(total_tokens=50)),
                Step(step=2, usage=Usage(total_tokens=60)),
            ]
        )
        configured = max_tokens(config)
        result = await configured(ctx)
        assert result is True  # 50 + 60 = 110 >= 100

    @pytest.mark.asyncio
    async def test_max_tokens_continues_when_limit_not_reached(self):
        """Test max_tokens continues when token limit not reached."""
        config = MaxTokensConfig(limit=200)
        ctx = StopConditionContext(
            steps=[
                Step(step=1, usage=Usage(total_tokens=50)),
                Step(step=2, usage=Usage(total_tokens=60)),
            ]
        )
        configured = max_tokens(config)
        result = await configured(ctx)
        assert result is False  # 50 + 60 = 110 < 200

    @pytest.mark.asyncio
    async def test_max_tokens_with_no_usage(self):
        """Test max_tokens with steps that have no usage."""
        config = MaxTokensConfig(limit=100)
        ctx = StopConditionContext(
            steps=[
                Step(step=1, usage=None),
                Step(step=2, usage=None),
            ]
        )
        configured = max_tokens(config)
        result = await configured(ctx)
        assert result is False  # 0 < 100


class TestMaxStepsStopCondition:
    """Tests for max_steps stop condition."""

    def test_max_steps_stops_when_count_reached(self):
        """Test max_steps stops when step count is reached."""
        config = MaxStepsConfig(count=3)
        ctx = StopConditionContext(
            steps=[
                Step(step=1),
                Step(step=2),
                Step(step=3),
            ]
        )
        configured = max_steps(config)
        result = configured(ctx)
        assert result is True  # 3 >= 3

    def test_max_steps_continues_when_count_not_reached(self):
        """Test max_steps continues when step count not reached."""
        config = MaxStepsConfig(count=5)
        ctx = StopConditionContext(
            steps=[
                Step(step=1),
                Step(step=2),
            ]
        )
        configured = max_steps(config)
        result = configured(ctx)
        assert result is False  # 2 < 5

    def test_max_steps_default_count(self):
        """Test max_steps uses default count=5."""
        config = MaxStepsConfig()  # Uses default count=5
        ctx = StopConditionContext(
            steps=[
                Step(step=1),
                Step(step=2),
                Step(step=3),
                Step(step=4),
                Step(step=5),
            ]
        )
        configured = max_steps(config)
        result = configured(ctx)
        assert result is True  # 5 >= 5


class TestExecutedToolStopCondition:
    """Tests for executed_tool stop condition."""

    def test_executed_tool_stops_when_all_tools_executed(self):
        """Test executed_tool stops when all required tools are executed."""
        config = ExecutedToolConfig(tool_names=["get_weather", "search"])
        ctx = StopConditionContext(
            steps=[
                Step(
                    step=1,
                    tool_calls=[
                        ToolCall(
                            id="call-1",
                            function=ToolCallFunction(name="get_weather", arguments="{}"),
                        )
                    ],
                ),
                Step(
                    step=2,
                    tool_calls=[
                        ToolCall(
                            id="call-2",
                            function=ToolCallFunction(name="search", arguments="{}"),
                        )
                    ],
                ),
            ]
        )
        configured = executed_tool(config)
        result = configured(ctx)
        assert result is True  # Both tools executed

    def test_executed_tool_continues_when_not_all_tools_executed(self):
        """Test executed_tool continues when not all required tools are executed."""
        config = ExecutedToolConfig(tool_names=["get_weather", "search"])
        ctx = StopConditionContext(
            steps=[
                Step(
                    step=1,
                    tool_calls=[
                        ToolCall(
                            id="call-1",
                            function=ToolCallFunction(name="get_weather", arguments="{}"),
                        )
                    ],
                ),
            ]
        )
        configured = executed_tool(config)
        result = configured(ctx)
        assert result is False  # Only one tool executed

    def test_executed_tool_with_empty_tool_names(self):
        """Test executed_tool returns False when tool_names is empty."""
        config = ExecutedToolConfig(tool_names=[])
        ctx = StopConditionContext(steps=[Step(step=1)])
        configured = executed_tool(config)
        result = configured(ctx)
        assert result is False


class TestHasTextStopCondition:
    """Tests for has_text stop condition."""

    def test_has_text_stops_when_all_texts_found(self):
        """Test has_text stops when all required texts are found."""
        config = HasTextConfig(texts=["done", "complete"])
        ctx = StopConditionContext(
            steps=[
                Step(step=1, content="Task is done"),
                Step(step=2, content="Process complete"),
            ]
        )
        configured = has_text(config)
        result = configured(ctx)
        assert result is True  # Both texts found

    def test_has_text_continues_when_not_all_texts_found(self):
        """Test has_text continues when not all required texts are found."""
        config = HasTextConfig(texts=["done", "complete"])
        ctx = StopConditionContext(
            steps=[
                Step(step=1, content="Task is done"),
            ]
        )
        configured = has_text(config)
        result = configured(ctx)
        assert result is False  # Only "done" found, "complete" missing

    def test_has_text_with_empty_texts(self):
        """Test has_text returns False when texts is empty."""
        config = HasTextConfig(texts=[])
        ctx = StopConditionContext(steps=[Step(step=1, content="test")])
        configured = has_text(config)
        result = configured(ctx)
        assert result is False

    def test_has_text_with_no_content(self):
        """Test has_text with steps that have no content."""
        config = HasTextConfig(texts=["done"])
        ctx = StopConditionContext(
            steps=[
                Step(step=1, content=None),
            ]
        )
        configured = has_text(config)
        result = configured(ctx)
        assert result is False  # No content to search
