"""
Client demonstrating event-triggered workflow patterns.

Run the worker first:
    python worker.py

Then run this client:
    python main.py
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient, events

from workflows import (
    event_publisher,
    event_waiter,
    PublishEventPayload,
    WaitForEventPayload,
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


async def demo_publish_event_triggers_workflow(client: PolosClient):
    """Demonstrate publishing an event that triggers a workflow."""
    print_header("Event-Triggered Workflow Demo")
    print("This demo shows how publishing an event triggers a workflow.")
    print("The 'on_order_created' workflow listens for 'orders/created' events.")

    print_section("Publishing event to 'orders/created' topic")

    # Publish an event directly using the events API
    order_data = {
        "order_id": "ORD-12345",
        "customer_id": "CUST-001",
        "items": [
            {"product": "Widget A", "quantity": 2, "price": 29.99},
            {"product": "Widget B", "quantity": 1, "price": 49.99},
        ],
        "total": 109.97,
    }

    print(f"  Order ID: {order_data['order_id']}")
    print(f"  Customer: {order_data['customer_id']}")
    print(f"  Total: ${order_data['total']}")

    # Publish the event
    await events.publish(
        client=client,
        topic="orders/created",
        event_data=events.EventData(event_type="order_created", data=order_data),
    )

    print("\n  Event published!")
    print("  The 'on_order_created' workflow should now be triggered.")
    print("  Check the worker logs to see the workflow execution.")


async def demo_publish_user_signup(client: PolosClient):
    """Demonstrate user signup event triggering a workflow."""
    print_header("User Signup Event Demo")
    print("Publishing a user signup event to trigger the 'on_user_signup' workflow.")

    print_section("Publishing event to 'users/signup' topic")

    user_data = {
        "user_id": "USER-42",
        "email": "newuser@example.com",
        "name": "New User",
    }

    print(f"  User ID: {user_data['user_id']}")
    print(f"  Email: {user_data['email']}")

    await events.publish(
        client=client,
        topic="users/signup",
        event_data=events.EventData(event_type="user_signup", data=user_data),
    )

    print("\n  Event published!")
    print("  The 'on_user_signup' workflow should now be triggered.")


async def demo_batch_events(client: PolosClient):
    """Demonstrate batch event processing."""
    print_header("Batch Event Processing Demo")
    print("Publishing multiple events to trigger the batch processor workflow.")
    print("The workflow batches up to 10 events or waits 30 seconds.")

    print_section("Publishing 5 events to 'data/updates' topic")

    events_to_publish = []
    for i in range(5):
        events_to_publish.append(
            events.EventData(
                event_type="data_update",
                data={"record_id": f"REC-{i + 1}", "value": (i + 1) * 10},
            )
        )
        print(f"  Event {i + 1}: record_id=REC-{i + 1}, value={(i + 1) * 10}")

    await events.batch_publish(
        client=client,
        topic="data/updates",
        events=events_to_publish,
    )

    print("\n  Events published!")
    print("  The 'batch_processor' workflow will process these in a batch.")
    print("  (It may wait up to 30 seconds for more events before triggering)")


async def demo_event_publisher_workflow(client: PolosClient):
    """Demonstrate the event_publisher workflow."""
    print_header("Event Publisher Workflow Demo")
    print("This workflow publishes events that can trigger other workflows.")

    print_section("Running event_publisher workflow")

    payload = PublishEventPayload(
        topic="orders/created",
        event_data={
            "order_id": "ORD-FROM-WORKFLOW",
            "customer_id": "CUST-002",
            "items": [{"product": "Widget C", "quantity": 3, "price": 19.99}],
            "total": 59.97,
        },
        event_type="order_created",
    )

    print(f"  Publishing to topic: {payload.topic}")
    print(f"  Event type: {payload.event_type}")

    result = await event_publisher.run(client, payload)

    print_section("Result")
    print(f"  Published: {result.published}")
    print(f"  Topic: {result.topic}")
    print(f"  Event type: {result.event_type}")
    print("\n  This event will trigger the 'on_order_created' workflow!")


async def demo_event_waiter_workflow(client: PolosClient):
    """Demonstrate the event_waiter workflow with a short timeout."""
    print_header("Event Waiter Workflow Demo")
    print("This workflow waits for an event on a specific topic.")
    print("We'll use a short timeout for demo purposes.")

    print_section("Starting event_waiter workflow")

    topic = "demo/notifications"
    timeout = 10  # 10 second timeout for demo

    print(f"  Waiting for events on topic: {topic}")
    print(f"  Timeout: {timeout} seconds")

    # Start the waiter workflow
    handle = await event_waiter.invoke(
        client,
        WaitForEventPayload(topic=topic, timeout=timeout),
    )

    print(f"\n  Workflow started with execution ID: {handle.id}")
    print("  Workflow is now waiting for an event...")

    # Wait a moment then publish an event
    print_section("Publishing event to wake up the waiter")
    await asyncio.sleep(2)

    await events.publish(
        client=client,
        topic=topic,
        event_data=events.EventData(
            event_type="notification",
            data={"message": "Hello from main.py!", "priority": "high"},
        ),
    )

    print("  Event published!")

    # Wait for the workflow to complete
    print_section("Waiting for workflow to complete")

    result = await handle.get(client)
    while result.get("status") not in ["completed", "failed"]:
        await asyncio.sleep(1)
        result = await handle.get(client)

    print("  Workflow result:")
    print(f"  Status: {result.get('status')}")
    print(f"  Result: {result.get('result')}")


async def main():
    """Run event-triggered workflow demos."""
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
    print("Event-Triggered Workflow Examples")
    print("=" * 60)
    print("\nMake sure the worker is running: python worker.py")
    print("\nThis demo showcases event-driven patterns:")
    print("  1. Publishing events that trigger workflows")
    print("  2. User signup event triggering onboarding")
    print("  3. Batch event processing")
    print("  4. Workflow that publishes events")
    print("  5. Workflow that waits for events")

    try:
        # Demo 1: Publish event to trigger order workflow
        await demo_publish_event_triggers_workflow(client)

        # Demo 2: Publish user signup event
        await demo_publish_user_signup(client)

        # Demo 3: Batch event processing
        await demo_batch_events(client)

        # Demo 4: Event publisher workflow
        await demo_event_publisher_workflow(client)

        # Demo 5: Event waiter workflow
        await demo_event_waiter_workflow(client)

        print("\n" + "=" * 60)
        print("All demos completed!")
        print("=" * 60)
        print("\nCheck the worker logs to see the event-triggered workflows execute.")

    except Exception as e:
        print(f"\nError: {e}")
        import traceback

        traceback.print_exc()
        print("\nMake sure the worker is running and try again.")


if __name__ == "__main__":
    asyncio.run(main())
