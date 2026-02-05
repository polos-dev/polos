"""Structured output schemas for order processing."""

from pydantic import BaseModel, Field


class ActionDetails(BaseModel):
    """Details about the action taken."""

    charge_id: str | None = Field(default=None, description="Stripe charge ID if payment was made")
    amount: float | None = Field(default=None, description="Amount charged or to be charged")
    email_sent_to: str | None = Field(default=None, description="Email address if confirmation was sent")
    message_id: str | None = Field(default=None, description="Email message ID if sent")


class OrderAgentOutput(BaseModel):
    """Structured output from the order processing agent."""

    action: str = Field(description="Action taken: 'charge', 'email', or 'complete'")
    action_details: ActionDetails = Field(description="Details about the action")
    action_requested: str | None = Field(
        default=None,
        description="Next action requested: 'fraud_review' for amounts over $1000, or None"
    )
    status_message: str = Field(description="Human-readable status message")
