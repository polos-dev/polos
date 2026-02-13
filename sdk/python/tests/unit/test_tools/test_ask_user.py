"""Tests for the ask_user tool -- matches TypeScript ask-user.test.ts."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from polos.core.context import WorkflowContext
from polos.core.workflow import _WORKFLOW_REGISTRY
from polos.tools.ask_user import create_ask_user_tool


def _make_ctx() -> WorkflowContext:
    ctx = WorkflowContext(
        workflow_id="test-wf",
        execution_id="exec-1",
        deployment_id="deploy-1",
        session_id="sess-1",
    )
    ctx.step = MagicMock()
    ctx.step.uuid = AsyncMock(return_value="uuid-456")
    ctx.step.suspend = AsyncMock()
    return ctx


class TestCreateAskUserTool:
    """Tests matching the TypeScript ask-user.test.ts."""

    def test_creates_a_tool_with_correct_id(self):
        tool = create_ask_user_tool()
        assert tool.id == "ask_user"

    def test_creates_a_tool_with_a_description(self):
        tool = create_ask_user_tool()
        assert tool._tool_description
        assert "Ask the user" in tool._tool_description

    def test_has_valid_llm_tool_definition(self):
        tool = create_ask_user_tool()
        defn = tool.to_llm_tool_definition()

        assert defn["type"] == "function"
        assert defn["function"]["name"] == "ask_user"
        assert defn["function"]["description"]
        assert isinstance(defn["function"]["parameters"], dict)
        assert "properties" in defn["function"]["parameters"]

    def test_input_schema_requires_question_parameter(self):
        tool = create_ask_user_tool()
        defn = tool.to_llm_tool_definition()
        props = defn["function"]["parameters"]["properties"]

        assert "question" in props

    def test_input_schema_includes_optional_title_parameter(self):
        tool = create_ask_user_tool()
        defn = tool.to_llm_tool_definition()
        props = defn["function"]["parameters"]["properties"]

        assert "title" in props

    def test_input_schema_includes_optional_fields_parameter(self):
        tool = create_ask_user_tool()
        defn = tool.to_llm_tool_definition()
        props = defn["function"]["parameters"]["properties"]

        assert "fields" in props

    def test_question_is_in_the_required_list(self):
        tool = create_ask_user_tool()
        defn = tool.to_llm_tool_definition()
        required = defn["function"]["parameters"].get("required", [])

        assert "question" in required

    def test_fields_and_title_are_not_in_the_required_list(self):
        tool = create_ask_user_tool()
        defn = tool.to_llm_tool_definition()
        required = defn["function"]["parameters"].get("required", [])

        assert "fields" not in required
        assert "title" not in required

    def test_is_auto_registered_in_the_global_registry(self):
        tool = create_ask_user_tool()
        assert "ask_user" in _WORKFLOW_REGISTRY
        assert _WORKFLOW_REGISTRY["ask_user"] is tool


class TestAskUserToolHandler:
    """Tests for the ask_user handler behavior."""

    @pytest.mark.asyncio
    async def test_suspends_with_default_textarea_field_when_no_fields_provided(self):
        tool = create_ask_user_tool()
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"response": "My answer"}}

        result = await tool.func(ctx, {"question": "What do you think?"})

        ctx.step.uuid.assert_called_once_with("_ask_user_id")
        ctx.step.suspend.assert_called_once()

        call_args = ctx.step.suspend.call_args
        step_key = call_args[0][0]
        suspend_data = call_args[0][1]

        assert step_key == "ask_user_uuid-456"

        assert suspend_data["_source"] == "ask_user"
        assert suspend_data["_tool"] == "ask_user"

        form = suspend_data["_form"]
        assert form["title"] == "Agent Question"
        assert form["description"] == "What do you think?"
        assert len(form["fields"]) == 1
        assert form["fields"][0]["key"] == "response"
        assert form["fields"][0]["type"] == "textarea"
        assert form["fields"][0]["required"] is True

        assert result == {"response": "My answer"}

    @pytest.mark.asyncio
    async def test_passes_custom_fields_through(self):
        tool = create_ask_user_tool()
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {"data": {"color": "blue"}}

        await tool.func(
            ctx,
            {
                "question": "Pick a color",
                "title": "Color Choice",
                "fields": [
                    {
                        "key": "color",
                        "type": "select",
                        "label": "Favorite color",
                        "options": [
                            {"label": "Red", "value": "red"},
                            {"label": "Blue", "value": "blue"},
                        ],
                    },
                ],
            },
        )

        call_args = ctx.step.suspend.call_args
        form = call_args[0][1]["_form"]
        assert form["title"] == "Color Choice"
        assert len(form["fields"]) == 1
        assert form["fields"][0]["key"] == "color"
        assert form["fields"][0]["type"] == "select"

    @pytest.mark.asyncio
    async def test_returns_empty_dict_when_response_has_no_data(self):
        tool = create_ask_user_tool()
        ctx = _make_ctx()
        ctx.step.suspend.return_value = {}

        result = await tool.func(ctx, {"question": "Hello?"})
        assert result == {}

    @pytest.mark.asyncio
    async def test_returns_empty_dict_for_non_dict_response(self):
        tool = create_ask_user_tool()
        ctx = _make_ctx()
        ctx.step.suspend.return_value = "unexpected"

        result = await tool.func(ctx, {"question": "Hello?"})
        assert result == {}
