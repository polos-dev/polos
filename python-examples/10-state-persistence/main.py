"""
Demonstrate stateful workflows with persistent state.

Run with:
    python main.py
"""

import asyncio

from dotenv import load_dotenv
from polos import Polos

from workflows import (
    counter_workflow,
    shopping_cart_workflow,
    stateful_with_initial_state,
    CounterPayload,
    CartPayload,
    CartItem,
    InitialStatePayload,
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


async def demo_counter_workflow(polos):
    """Demonstrate the counter workflow with persistent state."""
    print_header("Counter Workflow Demo")

    print_section("Incrementing counter")
    result = await counter_workflow.run(
        polos,
        CounterPayload(action="increment", amount=1),
    )
    print(f"  Count = {result.count}")

    print_section("Incrementing by 5")
    result = await counter_workflow.run(
        polos,
        CounterPayload(action="increment", amount=5),
    )
    print(f"  Count after +5: {result.count}")

    print_section("Decrementing by 2")
    result = await counter_workflow.run(
        polos,
        CounterPayload(action="decrement", amount=2),
    )
    print(f"  Count after -2: {result.count}")

    print_section("Resetting counter")
    result = await counter_workflow.run(
        polos,
        CounterPayload(action="reset"),
    )
    print(f"  Count after reset: {result.count}")
    print(f"  Last updated: {result.last_updated}")


async def demo_shopping_cart(polos):
    """Demonstrate the shopping cart workflow."""
    print_header("Shopping Cart Workflow Demo")
    print("This workflow adds items to a cart.")

    item = CartItem(id="item-1", name="Laptop", price=999.99, quantity=1)
    result = await shopping_cart_workflow.run(
        polos,
        CartPayload(
            action="add",
            item=item
        ),
    )
    print(f"  Added: {item.name} (${item.price} x {item.quantity})")


async def demo_initial_state(polos):
    """Demonstrate workflow with initial state."""
    print_header("Initial State Demo")
    print("This workflow demonstrates passing initial state when invoking.")

    print_section("Without initial state")
    result = await stateful_with_initial_state.run(
        polos,
        InitialStatePayload(increment=5),
    )
    print(f"  Original count: {result.original_count}")
    print(f"  New count: {result.new_count}")

    print_section("With initial state (count=100)")
    result = await stateful_with_initial_state.run(
        polos,
        InitialStatePayload(increment=5),
        initial_state=CounterState(count=100),
    )
    print(f"  Original count: {result.original_count}")
    print(f"  New count: {result.new_count}")

    print_section("With initial state (count=50)")
    result = await stateful_with_initial_state.run(
        polos,
        InitialStatePayload(increment=25),
        initial_state=CounterState(count=50),
    )
    print(f"  Original count: {result.original_count}")
    print(f"  New count: {result.new_count}")


async def main():
    """Run all state persistence demos."""
    print("=" * 60)
    print("State Persistence Workflow Examples")
    print("=" * 60)

    async with Polos(log_file="polos.log") as polos:
        try:
            await demo_counter_workflow(polos)
            await demo_shopping_cart(polos)
            await demo_initial_state(polos)

            print("\n" + "=" * 60)
            print("All demos completed!")
            print("=" * 60)

        except Exception as e:
            print(f"\nError: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
