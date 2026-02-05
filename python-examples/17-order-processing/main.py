"""Run the order processing workflow.

- Amount <= $1000: Charges and sends confirmation immediately
- Amount > $1000: Charges, waits for fraud review, then sends confirmation
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient
from polos.features import events

from workflows import order_processing_workflow, OrderPayload

load_dotenv()


async def main():
    """Run the order processing workflow."""
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError("POLOS_PROJECT_ID environment variable is required")

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    # Get order amount from user
    print("=" * 50)
    print("Order Processing Demo")
    print("=" * 50)
    print("  <= $1000: No fraud review (immediate confirmation)")
    print("  >  $1000: Requires fraud review before confirmation")
    print("=" * 50)

    amount_str = input("\nEnter order amount (e.g., 500 or 1500): $").strip()
    amount = float(amount_str) if amount_str else 99.99

    payload = OrderPayload(
        order_id="ORD-12345",
        customer_id="cust_abc123",
        customer_email="customer@example.com",
        amount=amount,
    )

    print(f"\nOrder ID: {payload.order_id}")
    print(f"Customer: {payload.customer_id}")
    print(f"Amount: ${payload.amount:.2f}")
    print(f"Fraud review: {'Required' if amount > 1000 else 'Not required'}")

    # Start the workflow
    print("\n" + "-" * 50)
    print("Starting workflow...")
    handle = await order_processing_workflow.invoke(client, payload)
    print(f"Execution ID: {handle.id}")

    # If amount > $1000, wait for fraud review suspend
    if amount > 1000:
        suspend_topic = f"fraud_review/{handle.id}"

        async for event in events.stream_topic(client, suspend_topic):
            if event.event_type == "suspend":
                data = event.data
                print("\n" + "*" * 50)
                print("*** FRAUD REVIEW REQUIRED ***")
                print("*" * 50)
                print(f"Order ID: {data.get('order_id')}")
                print(f"Customer: {data.get('customer_id')}")
                print(f"Amount: ${data.get('amount', 0):.2f}")
                print(f"Charge ID: {data.get('charge_id')}")
                print("*" * 50)
                break

    # Wait for completion
    print("\nWaiting...")
    while True:
        await asyncio.sleep(0.5)
        execution = await client.get_execution(handle.id)
        if execution.get("status") in ["completed", "failed"]:
            break

    print("\n" + "=" * 50)
    print("WORKFLOW COMPLETED")
    print("=" * 50)
    result = execution.get("result", {})
    print(result)
    print(f"Status: {execution.get('status')}")
    print(f"Charge ID: {result.get('charge_id')}")
    print(f"Fraud Review Required: {result.get('fraud_review_required')}")
    print(f"Fraud Approved: {result.get('fraud_approved')}")
    print(f"Email Sent: {result.get('email_sent')}")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())
