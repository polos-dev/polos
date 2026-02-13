"""Order processing agent with structured output."""

from polos import Agent, max_steps, MaxStepsConfig
from tools import charge_stripe, send_confirmation_email
from schemas import OrderAgentOutput


order_agent = Agent(
    id="order_agent",
    provider="openai",
    model="gpt-4o-mini",
    system_prompt="""You are an order processing assistant that handles payments and confirmations.

RULES:
1. When asked to process a payment, use the charge_stripe tool first
2. After charging:
   - If amount > $1000: Set action_requested='fraud_review' (human review needed) and DO NOT SEND confirmation email.
   - If amount <= $1000: Immediately send confirmation email using send_confirmation_email tool
3. In the case of fraud review:
   - When you receive fraud review approval, send the confirmation email
   - When you receive fraud review rejection, just report the rejection (no email)

Always respond with structured output indicating:
- action: last action that you did ('charge' or 'email')
- action_details: relevant IDs and amounts for the action
- action_requested: 'fraud_review' if needed, otherwise null
- status_message: human-readable summary""",
    tools=[charge_stripe, send_confirmation_email],
    output_schema=OrderAgentOutput,
    stop_conditions=[
        max_steps(MaxStepsConfig(count=10)),
    ],
)
