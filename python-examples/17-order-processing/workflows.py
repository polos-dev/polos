"""Order processing workflow with structured output and fraud review."""

from pydantic import BaseModel
from polos import workflow, WorkflowContext
from agents import order_agent
from schemas import OrderAgentOutput


class OrderPayload(BaseModel):
    """Input for order processing."""

    order_id: str
    customer_id: str
    customer_email: str
    amount: float


class OrderResult(BaseModel):
    """Result of order processing."""

    order_id: str
    status: str
    charge_id: str | None = None
    fraud_review_required: bool = False
    fraud_approved: bool | None = None
    email_sent: bool = False


@workflow(id="order_processing_workflow")
async def order_processing_workflow(
    ctx: WorkflowContext, payload: OrderPayload
) -> OrderResult:
    """Process an order with structured output and conditional fraud review.

    Flow:
    1. Agent charges customer via Stripe
    2. If amount > $1000: Agent requests fraud review, workflow suspends
    3. After fraud approval: Agent sends confirmation email
    4. If amount <= $1000: Agent sends confirmation immediately
    """
    # Step 1: Process the payment
    result = await ctx.step.agent_invoke_and_wait(
        "start_order",
        order_agent.with_input(
            f"Process payment for order {payload.order_id}. "
            f"Charge customer {payload.customer_id} for ${payload.amount:.2f} USD. "
            f"Customer email is {payload.customer_email}.",
        )
    )

    output: OrderAgentOutput = result.result
    charge_id = output.action_details.charge_id

    # Step 2: Check if fraud review is requested
    if output.action_requested == "fraud_review":
        execution_id = ctx.root_execution_id or ctx.execution_id
        await ctx.step.run("log_fraud_review", log_fraud_review, execution_id=execution_id)

        # Suspend for human fraud review
        resume_data = await ctx.step.suspend(
            "fraud_review",
            data={
                "order_id": payload.order_id,
                "customer_id": payload.customer_id,
                "amount": payload.amount,
                "charge_id": charge_id,
                "message": "Please review this order for fraud (amount > $1000)",
            },
            timeout=86400,
        )

        fraud_approved = resume_data.get("data", {}).get("approved", False)

        if not fraud_approved:
            print("\n--- Order rejected by fraud review ---")
            return OrderResult(
                order_id=payload.order_id,
                status="rejected",
                charge_id=charge_id,
                fraud_review_required=True,
                fraud_approved=False,
                email_sent=False,
            )

        # Step 3: Fraud approved - tell agent to send confirmation
        result = await ctx.step.agent_invoke_and_wait(
            "send_confirmation",
            order_agent.with_input(
                f"Fraud review APPROVED for order {payload.order_id}. "
                f"Charge ID: {charge_id}, Amount: ${payload.amount:.2f}. "
                f"Now send confirmation email to {payload.customer_email}.",
            )
        )

        output = result.result
        print(f"Agent action: {output.action}")
        print(f"Status: {output.status_message}")

        return OrderResult(
            order_id=payload.order_id,
            status="completed",
            charge_id=charge_id,
            fraud_review_required=True,
            fraud_approved=True,
            email_sent=True,
        )

    # No fraud review needed - agent already sent confirmation
    print("\n--- Order completed (no fraud review needed) ---")
    return OrderResult(
        order_id=payload.order_id,
        status="completed",
        charge_id=charge_id,
        fraud_review_required=False,
        fraud_approved=None,
        email_sent=True,
    )

async def log_fraud_review(execution_id: str):
    print("\n" + "*" * 60)
    print("*** FRAUD REVIEW REQUIRED ***")
    print("*** To approve: python approve_order.py " + execution_id)
    print("*** To reject:  python approve_order.py " + execution_id + " --reject")
    print("*" * 60 + "\n")