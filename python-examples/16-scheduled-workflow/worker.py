"""
Polos Worker for the Scheduled Workflow example.

Run with:
    python worker.py
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient, Worker

from workflows import (
    daily_cleanup,
    morning_report,
    hourly_sync,
    schedulable_reminder,
)

load_dotenv()


async def main():
    """Main function to run the worker."""
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

    worker = Worker(
        client=client,
        workflows=[
            daily_cleanup,
            morning_report,
            hourly_sync,
            schedulable_reminder,
        ],
    )

    print("Starting Scheduled Workflow Examples worker...")
    print(f"  Project ID: {project_id}")
    print(f"  Workflows: {[w.id for w in worker.workflows]}")
    print("  Scheduled workflows:")
    for w in worker.workflows:
        if hasattr(w, "schedule") and w.schedule:
            schedule = w.schedule
            if isinstance(schedule, dict):
                cron = schedule.get("cron", "N/A")
                tz = schedule.get("timezone", "UTC")
                print(f"    - {w.id}: {cron} ({tz})")
            elif isinstance(schedule, str):
                print(f"    - {w.id}: {schedule} (UTC)")
            elif schedule is True:
                print(f"    - {w.id}: (schedulable dynamically)")
    print("  Press Ctrl+C to stop\n")

    try:
        await worker.run()
    except KeyboardInterrupt:
        print("\nShutting down worker...")
        await worker.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
