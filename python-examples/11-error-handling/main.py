"""
Demonstrate error handling patterns in workflows.

Run with:
    python main.py
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos

from workflows import (
    retry_example,
    error_recovery,
    fallback_pattern,
    circuit_breaker,
    compensation_pattern,
    RetryPayload,
)

load_dotenv()


def print_header(title: str):
    """Print a formatted header."""
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


def print_section(title: str):
    """Print a section divider."""
    print(f"\n--- {title} ---")


async def demo_retry_example(polos):
    """Demonstrate automatic retry behavior."""
    print_header("Retry Example Demo")
    print("This workflow demonstrates automatic retry with exponential backoff.")
    print("The step may fail randomly but will be retried up to 3 times.")

    print_section("Low failure rate (10%)")
    try:
        result = await retry_example.run(
            polos,
            RetryPayload(failure_rate=0.1, operation="low_risk_process"),
        )
        print(f"  Status: {result['status']}")
        print(f"  Result: {result['result']}")
    except Exception as e:
        print(f"  Failed after retries: {e}")

    print_section("High failure rate (90%)")
    try:
        result = await retry_example.run(
            polos,
            RetryPayload(failure_rate=0.9, operation="high_risk_process"),
        )
        print(f"  Status: {result['status']}")
        print(f"  Result: {result['result']}")
    except Exception as e:
        print(f"  Failed after retries (expected): {e}")


async def demo_error_recovery(polos):
    """Demonstrate error recovery patterns."""
    print_header("Error Recovery Demo")
    print("This workflow processes items and continues even if some fail.")
    print("Items with 'fail' in their name will fail.")

    print_section("Processing mixed items")
    result = await error_recovery.run(
        polos,
        {"items": ["item1", "item2", "fail_item", "item3", "another_fail"]},
    )

    print(f"  Processed: {result['processed']} items")
    print(f"  Failed: {result['failed']} items")

    if result['results']:
        print("\n  Successful results:")
        for r in result['results']:
            print(f"    - {r['item']}: {r['status']}")

    if result['errors']:
        print("\n  Errors:")
        for e in result['errors']:
            print(f"    - {e['item']}: {e['error'][:50]}...")


async def demo_fallback_pattern(polos):
    """Demonstrate fallback pattern."""
    print_header("Fallback Pattern Demo")
    print("This workflow tries primary method first, then falls back if it fails.")

    print_section("Primary method succeeds")
    result = await fallback_pattern.run(
        polos,
        {"data": {"value": "test_data"}},
    )
    print(f"  Method used: {result['method']}")
    if 'result' in result:
        print(f"  Result: {result['result']}")

    print_section("Primary fails, using fallback")
    result = await fallback_pattern.run(
        polos,
        {"data": {"value": "test_data", "force_failure": True}},
    )
    print(f"  Method used: {result['method']}")
    if 'result' in result:
        degraded = result['result'].get('degraded', False)
        print(f"  Result: {result['result']}")
        if degraded:
            print("  (Running in degraded mode)")


async def demo_circuit_breaker(polos):
    """Demonstrate circuit breaker pattern."""
    print_header("Circuit Breaker Demo")
    print("This workflow stops processing after too many consecutive failures.")
    print("Circuit opens after 3 failures, remaining items are skipped.")

    print_section("Processing with circuit breaker")
    items = [
        {"id": 1, "name": "item1"},
        {"id": 2, "name": "item2"},
        {"id": 3, "name": "item3", "should_fail": True},
        {"id": 4, "name": "item4", "should_fail": True},
        {"id": 5, "name": "item5", "should_fail": True},
        {"id": 6, "name": "item6"},
        {"id": 7, "name": "item7"},
    ]

    result = await circuit_breaker.run(
        polos,
        {"items": items, "failure_threshold": 3},
    )

    print(f"  Circuit open: {result['circuit_open']}")
    print(f"  Total failures: {result['total_failures']}")
    print("\n  Results:")
    for r in result['results']:
        item_id = r.get('item', {}).get('id', '?') if isinstance(r.get('item'), dict) else '?'
        status = r['status']
        reason = f" ({r['reason']})" if 'reason' in r else ""
        print(f"    - Item {item_id}: {status}{reason}")


async def demo_compensation_pattern(polos):
    """Demonstrate compensation (rollback) pattern."""
    print_header("Compensation Pattern Demo")
    print("This workflow performs a saga with compensation on failure.")
    print("Steps: reserve_inventory -> charge_payment -> send_confirmation")

    print_section("Successful transaction")
    result = await compensation_pattern.run(
        polos,
        {"order_id": "ORDER-001"},
    )
    print(f"  Status: {result['status']}")
    print(f"  Completed steps: {result.get('completed', [])}")

    print_section("Failed transaction with rollback")
    result = await compensation_pattern.run(
        polos,
        {"order_id": "ORDER-002", "fail_confirmation": True},
    )
    print(f"  Status: {result['status']}")
    if result['status'] == 'rolled_back':
        print(f"  Error: {result.get('error', 'Unknown')[:50]}...")
        print(f"  Compensated steps: {result.get('compensated', [])}")


async def main():
    """Run all error handling demos."""
    print("=" * 60)
    print("Error Handling Workflow Examples")
    print("=" * 60)

    async with Polos(log_file="polos.log") as polos:
        try:
            await demo_retry_example(polos)
            await demo_error_recovery(polos)
            await demo_fallback_pattern(polos)
            await demo_circuit_breaker(polos)
            await demo_compensation_pattern(polos)

            print("\n" + "=" * 60)
            print("All demos completed!")
            print("=" * 60)

        except Exception as e:
            print(f"\nError: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
