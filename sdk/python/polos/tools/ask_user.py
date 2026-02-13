"""Ask-user tool -- lets agents ask questions and receive answers from the user.

Uses ctx.step.suspend() to pause the workflow, emit a suspend event with a
_form schema, and wait for the user to respond via client.resume(). Supports
both structured form fields and simple free-text responses.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from ..core.context import WorkflowContext
from .tool import Tool

# ── Input schema ──────────────────────────────────────────────────────


class AskUserFieldOption(BaseModel):
    """Option for a select field."""

    label: str
    value: str


class AskUserField(BaseModel):
    """A single form field definition."""

    key: str = Field(description="Unique key for this field")
    type: Literal["text", "textarea", "number", "boolean", "select"] = Field(
        description="Field type"
    )
    label: str = Field(description="Label shown to user")
    description: str | None = Field(default=None, description="Help text for the field")
    required: bool | None = Field(default=None, description="Whether this field is required")
    options: list[AskUserFieldOption] | None = Field(
        default=None, description="Options for select fields"
    )


class AskUserInput(BaseModel):
    """Input schema for the ask_user tool."""

    question: str = Field(description="The question to ask the user")
    title: str | None = Field(
        default=None, description="Short title for the question (shown as heading)"
    )
    fields: list[AskUserField] | None = Field(
        default=None,
        description=(
            "Structured form fields for the response. "
            "If omitted, shows a single text response field."
        ),
    )


# ── Factory ───────────────────────────────────────────────────────────


def create_ask_user_tool() -> Tool:
    """Create the ask_user tool for agent-to-user communication.

    When an agent calls this tool, the workflow suspends and emits a suspend
    event with a ``_form`` schema.  The client handles the event, collects
    the user's response, and resumes the workflow with the response data.

    Example::

        from polos import create_ask_user_tool

        ask_user = create_ask_user_tool()
        # Add to agent tools array
    """

    async def handler(ctx: WorkflowContext, input: AskUserInput) -> dict[str, Any]:
        # Build fields -- default to a single textarea field if none provided
        if input.fields is not None:
            fields = [f.model_dump(exclude_none=True) for f in input.fields]
        else:
            fields = [
                {
                    "key": "response",
                    "type": "textarea",
                    "label": input.question,
                    "required": True,
                },
            ]

        ask_id = await ctx.step.uuid("_ask_user_id")
        response = await ctx.step.suspend(
            f"ask_user_{ask_id}",
            {
                "_form": {
                    "title": input.title or "Agent Question",
                    "description": input.question,
                    "fields": fields,
                },
                "_source": "ask_user",
                "_tool": "ask_user",
            },
        )

        data = response.get("data", {}) if isinstance(response, dict) else {}
        return data

    async def wrapped_func(ctx: WorkflowContext, payload: dict[str, Any] | None):
        input_obj = AskUserInput.model_validate(payload) if payload else AskUserInput(question="")
        return await handler(ctx, input_obj)

    tool = Tool(
        id="ask_user",
        description=(
            "Ask the user a question and wait for their response. "
            "Use this when you need clarification, a decision, or any input from the user. "
            "You can define structured fields (text, select, boolean, etc.) "
            "for specific response formats, or omit fields for a free-text response."
        ),
        parameters=AskUserInput.model_json_schema(),
        func=wrapped_func,
    )
    tool._input_schema_class = AskUserInput
    return tool
