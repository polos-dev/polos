"""Utility to approve an order pending fraud review.

Usage:
    python approve_order.py <execution_id>
    python approve_order.py <execution_id> --reject
"""

import asyncio
import os
import sys

from dotenv import load_dotenv
from polos import PolosClient

load_dotenv()


async def main():
    if len(sys.argv) < 2:
        print("Usage: python approve_order.py <execution_id> [--reject]")
        sys.exit(1)

    execution_id = sys.argv[1]
    approved = "--reject" not in sys.argv

    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError("POLOS_PROJECT_ID environment variable is required")

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    print(f"{'Approving' if approved else 'Rejecting'} order...")
    print(f"  Execution ID: {execution_id}")

    await client.resume(
        suspend_execution_id=execution_id,
        suspend_step_key="fraud_review",
        data={"approved": approved},
    )

    print(f"Done! Order {'approved' if approved else 'rejected'}.")


if __name__ == "__main__":
    asyncio.run(main())
