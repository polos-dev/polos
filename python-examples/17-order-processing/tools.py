"""Tools for order processing."""

from pydantic import BaseModel
from polos import tool, WorkflowContext


class ChargeStripeInput(BaseModel):
    """Input for charging a customer via Stripe."""

    customer_id: str
    amount: float
    currency: str = "usd"


class ChargeStripeOutput(BaseModel):
    """Output from Stripe charge."""

    charge_id: str
    status: str
    amount: float
    currency: str


@tool(description="Charge a customer using Stripe payment processing")
async def charge_stripe(ctx: WorkflowContext, input: ChargeStripeInput) -> ChargeStripeOutput:
    """Charge a customer via Stripe."""
    print("\n" + "*" * 50)
    print("*** CHARGING CUSTOMER VIA STRIPE ***")
    print(f"*** Customer: {input.customer_id}")
    print(f"*** Amount: ${input.amount:.2f} {input.currency.upper()}")
    print("*** Processing payment...")
    print("*** Payment successful!")
    print("*" * 50 + "\n")

    return ChargeStripeOutput(
        charge_id=f"ch_{input.customer_id}_001",
        status="succeeded",
        amount=input.amount,
        currency=input.currency,
    )


class SendEmailInput(BaseModel):
    """Input for sending confirmation email."""

    email: str
    order_id: str
    amount: float


class SendEmailOutput(BaseModel):
    """Output from sending email."""

    sent: bool
    message_id: str


@tool(description="Send order confirmation email to customer")
async def send_confirmation_email(
    ctx: WorkflowContext, input: SendEmailInput
) -> SendEmailOutput:
    """Send confirmation email."""
    print("\n" + "*" * 50)
    print("*** SENDING CONFIRMATION EMAIL ***")
    print(f"*** To: {input.email}")
    print(f"*** Order: {input.order_id}")
    print(f"*** Amount: ${input.amount:.2f}")
    print("*** Email sent successfully!")
    print("*" * 50 + "\n")

    return SendEmailOutput(
        sent=True,
        message_id=f"msg_{input.order_id}_001",
    )
