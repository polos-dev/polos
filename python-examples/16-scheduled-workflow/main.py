"""
Demonstrate scheduled workflow patterns.

Run with:
    python main.py
"""

import asyncio
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from polos import (
    Polos,
    schedules,
    SchedulePayload,
)

from workflows import daily_cleanup

load_dotenv()


def print_header(title: str):
    """Print a formatted header."""
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


def print_section(title: str):
    """Print a section divider."""
    print(f"\n--- {title} ---")


async def demo_create_schedule(polos):
    """Demonstrate creating a schedule for a workflow."""
    print_header("Create Schedule Demo")
    print("This demo shows how to create a schedule dynamically using schedules.create().")
    print("The 'schedulable_reminder' workflow has schedule=True, meaning it can be")
    print("scheduled dynamically but has no default schedule.")

    print_section("Creating a schedule for 'schedulable_reminder'")

    cron = "* * * * *"
    tz = "UTC"
    key = "demo-user-123"

    print(f"  Workflow: schedulable_reminder")
    print(f"  Cron: {cron} (every minute)")
    print(f"  Timezone: {tz}")
    print(f"  Key: {key}")

    schedule_id = await schedules.create(
        client=polos,
        workflow="schedulable_reminder",
        cron=cron,
        timezone=tz,
        key=key,
    )

    print(f"\n  Schedule created!")
    print(f"  Schedule ID: {schedule_id}")
    print("\n  The workflow will now run automatically every minute.")
    print("  Check the logs to see the scheduled executions.")


async def demo_create_per_user_schedules(polos):
    """Demonstrate creating per-user schedules."""
    print_header("Per-User Schedules Demo")
    print("This demo shows how to create different schedules for different users.")
    print("Each user gets their own schedule with the same workflow.")

    users = [
        {"id": "user-alice", "cron": "0 8 * * *", "tz": "America/New_York"},
        {"id": "user-bob", "cron": "0 9 * * *", "tz": "Europe/London"},
        {"id": "user-charlie", "cron": "0 7 * * *", "tz": "Asia/Tokyo"},
    ]

    print_section("Creating per-user schedules")

    for user in users:
        schedule_id = await schedules.create(
            client=polos,
            workflow="schedulable_reminder",
            cron=user["cron"],
            timezone=user["tz"],
            key=user["id"],
        )
        print(f"  {user['id']}: {user['cron']} ({user['tz']}) -> {schedule_id}")

    print("\n  Each user now has their own personalized schedule!")
    print("  Alice: 8 AM New York time")
    print("  Bob: 9 AM London time")
    print("  Charlie: 7 AM Tokyo time")


async def demo_manual_trigger_with_schedule_payload(polos):
    """Demonstrate manually triggering a scheduled workflow with SchedulePayload."""
    print_header("Manual Trigger with SchedulePayload Demo")
    print("This demo shows how to manually trigger a scheduled workflow")
    print("by passing a SchedulePayload directly to run().")
    print("This is useful for testing scheduled workflows without waiting.")

    print_section("Running 'daily_cleanup' with manual SchedulePayload")

    now = datetime.now(timezone.utc)
    payload = SchedulePayload(
        timestamp=now,
        last_timestamp=now - timedelta(days=1),
        timezone="UTC",
        schedule_id="manual-test-schedule",
        key="manual-test",
        upcoming=now + timedelta(days=1),
    )

    print(f"  Timestamp: {payload.timestamp}")
    print(f"  Last run: {payload.last_timestamp}")
    print(f"  Timezone: {payload.timezone}")
    print(f"  Schedule ID: {payload.schedule_id}")
    print(f"  Key: {payload.key}")
    print(f"  Next run: {payload.upcoming}")

    result = await daily_cleanup.run(polos, payload)

    print_section("Result")
    print(f"  Timestamp: {result.timestamp}")
    print(f"  Records cleaned: {result.records_cleaned}")
    print(f"  Files cleaned: {result.files_cleaned}")


async def main():
    """Run scheduled workflow demos."""
    print("=" * 60)
    print("Scheduled Workflow Examples")
    print("=" * 60)
    print("\nThis demo showcases scheduled workflow patterns:")
    print("  1. Creating schedules dynamically with schedules.create()")
    print("  2. Per-user/per-entity schedules")
    print("  3. Manually triggering scheduled workflow with SchedulePayload")

    async with Polos(log_file="polos.log") as polos:
        try:
            await demo_create_schedule(polos)
            await demo_create_per_user_schedules(polos)
            await demo_manual_trigger_with_schedule_payload(polos)

            print("\n" + "=" * 60)
            print("All demos completed!")
            print("=" * 60)
            print("\nScheduled workflows will run automatically based on their cron expressions.")
            print("Check the logs to see scheduled executions.")

        except Exception as e:
            print(f"\nError: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
