"""
Client demonstrating stateful workflows with persistent state.

Run the worker first:
    python worker.py

Then run this client:
    python main.py
"""

import asyncio
import os
import uuid

from dotenv import load_dotenv
from polos import PolosClient

from workflows import (
    counter_workflow,
    shopping_cart_workflow,
    stateful_with_initial_state,
    # Payload models
    CounterPayload,
    CartPayload,
    CartItem,
    InitialStatePayload,
    # State models (for initial_state)
    CounterState,
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


async def demo_counter_workflow(client: PolosClient):
    """Demonstrate the counter workflow with persistent state."""
    print_header("Counter Workflow Demo")

    # Increment the counter 3 times
    print_section("Incrementing counter")
    result = await counter_workflow.run(
        client,
        CounterPayload(action="increment", amount=1),
    )
    print(f"  Count = {result.count}")

    # Increment by 5
    print_section("Incrementing by 5")
    result = await counter_workflow.run(
        client,
        CounterPayload(action="increment", amount=5),
    )
    print(f"  Count after +5: {result.count}")

    # Decrement by 2
    print_section("Decrementing by 2")
    result = await counter_workflow.run(
        client,
        CounterPayload(action="decrement", amount=2),
    )
    print(f"  Count after -2: {result.count}")

    # Reset
    print_section("Resetting counter")
    result = await counter_workflow.run(
        client,
        CounterPayload(action="reset"),
    )
    print(f"  Count after reset: {result.count}")
    print(f"  Last updated: {result.last_updated}")


async def demo_shopping_cart(client: PolosClient):
    """Demonstrate the shopping cart workflow."""
    print_header("Shopping Cart Workflow Demo")
    print("This workflow adds items to a cart.")

    item = CartItem(id="item-1", name="Laptop", price=999.99, quantity=1)
    result = await shopping_cart_workflow.run(
        client,
        CartPayload(
            action="add",
            item=item
        ),
    )
    print(f"  Added: {item.name} (${item.price} x {item.quantity})")


async def demo_initial_state(client: PolosClient):
    """Demonstrate workflow with initial state."""
    print_header("Initial State Demo")
    print("This workflow demonstrates passing initial state when invoking.")

    # Invoke without initial state (starts at 0)
    print_section("Without initial state")
    result = await stateful_with_initial_state.run(
        client,
        InitialStatePayload(increment=5),
    )
    print(f"  Original count: {result.original_count}")
    print(f"  New count: {result.new_count}")

    # Invoke with initial state
    print_section("With initial state (count=100)")
    result = await stateful_with_initial_state.run(
        client,
        InitialStatePayload(increment=5),
        initial_state=CounterState(count=100),
    )
    print(f"  Original count: {result.original_count}")
    print(f"  New count: {result.new_count}")

    # Another example with different initial state
    print_section("With initial state (count=50)")
    result = await stateful_with_initial_state.run(
        client,
        InitialStatePayload(increment=25),
        initial_state=CounterState(count=50),
    )
    print(f"  Original count: {result.original_count}")
    print(f"  New count: {result.new_count}")


async def main():
    """Run all state persistence demos."""
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Get it from the Polos UI at http://localhost:5173/projects/settings"
        )

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
    )

    print("=" * 60)
    print("State Persistence Workflow Examples")
    print("=" * 60)
    print("\nMake sure the worker is running: python worker.py")

    try:
        await demo_counter_workflow(client)
        await demo_shopping_cart(client)
        await demo_initial_state(client)

        print("\n" + "=" * 60)
        print("All demos completed!")
        print("=" * 60)

    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        print("\nMake sure the worker is running and try again.")


if __name__ == "__main__":
    asyncio.run(main())
