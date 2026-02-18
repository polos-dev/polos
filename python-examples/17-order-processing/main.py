"""Run the order processing workflow.

- Amount <= $1000: Charges and sends confirmation immediately
- Amount > $1000: Charges, waits for fraud review, then sends confirmation

Run with:
    python main.py
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos
from polos.features import events

from workflows import order_processing_workflow, OrderPayload

load_dotenv()


async def main():
    """Run the order processing workflow."""
    async with Polos(log_file="polos.log") as polos:
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

        print("\n" + "-" * 50)
        print("Starting workflow...")
        handle = await order_processing_workflow.invoke(polos, payload)
        print(f"Execution ID: {handle.id}")

        if amount > 1000:
            async for event in events.stream_workflow(polos, handle.root_workflow_id, handle.id):
                if event.event_type.startswith("suspend_"):
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

        print("\nWaiting...")
        while True:
            await asyncio.sleep(0.5)
            execution = await polos.get_execution(handle.id)
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
