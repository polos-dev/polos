"""Agent and tool definitions for the Slack channel example."""

from pydantic import BaseModel, Field

from polos import Agent, WorkflowContext, tool


# ── Tool with approval: 'always' ─────────────────────────────────────
# Suspends for approval before execution.
# Slack renders inline Approve/Reject buttons for this.


class SendEmailInput(BaseModel):
    """Input schema for the send_email tool."""

    to: str = Field(description="Recipient email address")
    subject: str = Field(description="Email subject line")
    body: str = Field(description="Email body text")


@tool(id="send_email", description="Send an email to a recipient. Requires approval before sending.", approval="always")
async def send_email(ctx: WorkflowContext, input: SendEmailInput) -> dict:
    """Simulated email send — in production this would call an email API."""
    return {"sent": True, "to": input.to, "subject": input.subject}


# ── Agent ─────────────────────────────────────────────────────────────
# When triggered from Slack, ask_user notifications route to the
# originating thread via channelContext (no explicit channels needed).
assistant_agent = Agent(
    id="slack-assistant",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt=(
        "You are a helpful assistant that can send emails.  "
        "When asked to send an email, use the send_email tool. "
        "Be concise and direct."
    ),
    tools=[send_email],
)
