"""Tests for the Tool approval feature."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import BaseModel

from polos.core.context import WorkflowContext
from polos.tools.tool import Tool, _wrap_with_approval, tool

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class SampleInput(BaseModel):
    query: str


def _make_ctx() -> WorkflowContext:
    """Create a minimal WorkflowContext with mocked step helpers."""
    ctx = WorkflowContext(
        workflow_id="test-wf",
        execution_id="exec-1",
        deployment_id="deploy-1",
        session_id="sess-1",
    )
    ctx.step = MagicMock()
    ctx.step.uuid = AsyncMock(return_value="uuid-123")
    ctx.step.suspend = AsyncMock()
    return ctx


# ---------------------------------------------------------------------------
# Tests for default / no-approval behaviour
# ---------------------------------------------------------------------------


class TestToolApprovalNone:
    """Tools with approval=None or approval='none' should NOT suspend."""

    @pytest.mark.asyncio
    async def test_default_approval_does_not_suspend(self):
        """Tool with default (None) approval runs handler directly."""
        handler_called = False

        async def handler(ctx: WorkflowContext) -> dict:
            nonlocal handler_called
            handler_called = True
            return {"ok": True}

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return await handler(ctx)

        t = Tool(id="test_no_approval", func=wrapped)
        ctx = _make_ctx()
        result = await t.func(ctx, None)

        assert handler_called
        assert result == {"ok": True}
        ctx.step.suspend.assert_not_called()

    @pytest.mark.asyncio
    async def test_approval_none_literal_does_not_suspend(self):
        """Tool with approval='none' runs handler directly."""
        handler_called = False

        async def handler(ctx: WorkflowContext) -> dict:
            nonlocal handler_called
            handler_called = True
            return {"ok": True}

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return await handler(ctx)

        t = Tool(id="test_none_literal", func=wrapped, approval="none")
        ctx = _make_ctx()
        result = await t.func(ctx, None)

        assert handler_called
        assert result == {"ok": True}
        ctx.step.suspend.assert_not_called()


# ---------------------------------------------------------------------------
# Tests for approval='always'
# ---------------------------------------------------------------------------


class TestToolApprovalAlways:
    """Tools with approval='always' should suspend for user approval."""

    @pytest.mark.asyncio
    async def test_suspend_called_with_correct_form(self):
        """approval='always' suspends with the expected form metadata."""

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return {"result": "done"}

        t = Tool(id="my_tool", func=wrapped, approval="always")
        ctx = _make_ctx()

        # Simulate approved response
        ctx.step.suspend.return_value = {"data": {"approved": True}}

        await t.func(ctx, {"query": "hello"})

        # Verify suspend was called
        ctx.step.uuid.assert_called_once_with("_approval_id")
        ctx.step.suspend.assert_called_once()

        call_args = ctx.step.suspend.call_args
        step_key = call_args[0][0]
        suspend_data = call_args[0][1]

        # Step key format
        assert step_key == "approve_my_tool_uuid-123"

        # Form metadata structure
        assert suspend_data["_source"] == "tool_approval"
        assert suspend_data["_tool"] == "my_tool"

        form = suspend_data["_form"]
        assert form["title"] == "Approve tool: my_tool"
        assert '"my_tool"' in form["description"]

        # Fields
        fields = form["fields"]
        assert len(fields) == 2

        approved_field = fields[0]
        assert approved_field["key"] == "approved"
        assert approved_field["type"] == "boolean"
        assert approved_field["required"] is True
        assert approved_field["default"] is False

        feedback_field = fields[1]
        assert feedback_field["key"] == "feedback"
        assert feedback_field["type"] == "textarea"
        assert feedback_field["required"] is False

        # Context
        form_ctx = form["context"]
        assert form_ctx["tool"] == "my_tool"
        assert form_ctx["input"] == {"query": "hello"}

    @pytest.mark.asyncio
    async def test_approved_executes_handler(self):
        """When approved, the original handler is called."""
        handler_called = False

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            nonlocal handler_called
            handler_called = True
            return {"result": payload}

        t = Tool(id="approved_tool", func=wrapped, approval="always")
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"approved": True}}

        result = await t.func(ctx, {"x": 1})

        assert handler_called
        assert result == {"result": {"x": 1}}

    @pytest.mark.asyncio
    async def test_rejected_raises_runtime_error(self):
        """When rejected, raises RuntimeError."""

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return {"should": "not run"}

        t = Tool(id="rejected_tool", func=wrapped, approval="always")
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"approved": False}}

        with pytest.raises(RuntimeError, match='Tool "rejected_tool" was rejected by the user.'):
            await t.func(ctx, None)

    @pytest.mark.asyncio
    async def test_rejected_with_feedback(self):
        """When rejected with feedback, error message includes feedback."""

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return {}

        t = Tool(id="fb_tool", func=wrapped, approval="always")
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {
            "data": {"approved": False, "feedback": "Use a different approach"}
        }

        with pytest.raises(RuntimeError, match="Feedback: Use a different approach"):
            await t.func(ctx, None)

    @pytest.mark.asyncio
    async def test_rejected_without_feedback(self):
        """When rejected without feedback, error message has no feedback suffix."""

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return {}

        t = Tool(id="nofb_tool", func=wrapped, approval="always")
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"approved": False}}

        with pytest.raises(RuntimeError) as exc_info:
            await t.func(ctx, None)

        assert "Feedback:" not in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_missing_data_treated_as_rejection(self):
        """If the resume response has no 'data', treat as rejection."""

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return {}

        t = Tool(id="nodata_tool", func=wrapped, approval="always")
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {}

        with pytest.raises(RuntimeError, match='Tool "nodata_tool" was rejected'):
            await t.func(ctx, None)

    @pytest.mark.asyncio
    async def test_non_dict_response_treated_as_rejection(self):
        """If the resume response is not a dict, treat as rejection."""

        async def wrapped(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return {}

        t = Tool(id="badresp_tool", func=wrapped, approval="always")
        ctx = _make_ctx()
        ctx.step.suspend.return_value = "unexpected"

        with pytest.raises(RuntimeError, match='Tool "badresp_tool" was rejected'):
            await t.func(ctx, None)


# ---------------------------------------------------------------------------
# Tests for _wrap_with_approval with input_schema_class
# ---------------------------------------------------------------------------


class TestWrapWithApprovalSchema:
    """_wrap_with_approval validates payload via input_schema_class when provided."""

    @pytest.mark.asyncio
    async def test_schema_class_used_for_context(self):
        """When input_schema_class is provided, the form context uses validated data."""
        inner_called = False

        async def inner(ctx: WorkflowContext, payload: dict[str, Any] | None):
            nonlocal inner_called
            inner_called = True
            return payload

        wrapped = _wrap_with_approval(inner, "schema_tool", SampleInput)
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"approved": True}}

        await wrapped(ctx, {"query": "test"})

        # Verify context.input was validated through the schema
        call_args = ctx.step.suspend.call_args
        form = call_args[0][1]["_form"]
        assert form["context"]["input"] == {"query": "test"}
        assert inner_called

    @pytest.mark.asyncio
    async def test_schema_validation_failure_falls_back_to_raw_payload(self):
        """If schema validation fails, raw payload is used as context."""

        async def inner(ctx: WorkflowContext, payload: dict[str, Any] | None):
            return payload

        wrapped = _wrap_with_approval(inner, "fallback_tool", SampleInput)
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"approved": True}}

        # 'query' is required by SampleInput, so passing without it should fail validation
        # but the wrapper should fall back to raw payload
        bad_payload = {"wrong_field": "value"}
        await wrapped(ctx, bad_payload)

        call_args = ctx.step.suspend.call_args
        form = call_args[0][1]["_form"]
        assert form["context"]["input"] == bad_payload


# ---------------------------------------------------------------------------
# Tests for @tool decorator with approval
# ---------------------------------------------------------------------------


class TestToolDecoratorApproval:
    """The @tool() decorator passes approval through to the Tool."""

    def test_decorator_sets_approval(self):
        """@tool(approval='always') sets _approval on the Tool."""

        @tool(id="dec_tool", approval="always")
        async def my_tool(ctx: WorkflowContext) -> dict:
            return {}

        assert my_tool._approval == "always"

    def test_decorator_default_no_approval(self):
        """@tool() without approval sets _approval=None."""

        @tool(id="dec_no_approval")
        async def my_tool(ctx: WorkflowContext) -> dict:
            return {}

        assert my_tool._approval is None

    @pytest.mark.asyncio
    async def test_decorator_approval_always_suspends(self):
        """@tool(approval='always') wraps the handler with approval gate."""
        handler_called = False

        @tool(id="dec_approval_tool", approval="always")
        async def my_tool(ctx: WorkflowContext) -> dict:
            nonlocal handler_called
            handler_called = True
            return {"done": True}

        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"approved": True}}

        result = await my_tool.func(ctx, None)

        assert handler_called
        assert result == {"done": True}
        ctx.step.suspend.assert_called_once()

    @pytest.mark.asyncio
    async def test_decorator_with_input_schema_and_approval(self):
        """@tool(approval='always') works with Pydantic input schemas."""

        @tool(id="dec_schema_approval", approval="always")
        async def my_tool(ctx: WorkflowContext, input: SampleInput) -> dict:
            return {"query": input.query}

        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"approved": True}}

        result = await my_tool.func(ctx, {"query": "hello"})

        assert result == {"query": "hello"}
        ctx.step.suspend.assert_called_once()
