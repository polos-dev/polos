"""Schedule management for Polos workflows."""

from datetime import datetime

import httpx
from pydantic import BaseModel

from ..runtime.client import _config


class SchedulePayload(BaseModel):
    """Payload passed to scheduled workflows.

    Attributes:
        timestamp: When this workflow was scheduled to run
        last_timestamp: When this schedule last ran (None if first run)
        timezone: Timezone of the schedule
        schedule_id: Unique identifier for this schedule
        key: User ID or custom identifier for the schedule
        upcoming: Next scheduled run time
    """

    timestamp: datetime
    last_timestamp: datetime | None
    timezone: str
    schedule_id: str
    key: str
    upcoming: datetime


async def create(
    workflow: str,
    cron: str,
    timezone: str = "UTC",
    key: str = "global",
) -> str:
    """Create or update a schedule for a workflow.

    If a schedule with the same workflow and key already exists, it will be updated.
    If key is None, multiple schedules can exist for the same workflow.

    Args:
        workflow: Workflow ID to schedule
        cron: Cron expression (e.g., "0 8 * * *" for 8 AM daily)
        timezone: Timezone for the schedule (default: "UTC")
        key: Key for per-user/per-entity schedules. Defaults to "global" for global schedules.
            If a schedule with the same workflow and key exists, it will be updated.

    Returns:
        schedule_id: Unique identifier for the schedule

    Example:
        # Per-user schedule (updates if same key exists)
        await schedules.create(
            workflow="daily-reminder",
            cron="0 8 * * *",
            timezone="America/New_York",
            key=user.id
        )

        # Global schedule (can create multiple)
        await schedules.create(
            workflow="system-cleanup",
            cron="0 3 * * *"
        )
    """
    api_url = _config["api_url"]
    headers = {"Content-Type": "application/json"}

    if _config["api_key"]:
        headers["Authorization"] = f"Bearer {_config['api_key']}"

    payload = {
        "workflow_id": workflow,
        "cron": cron,
        "timezone": timezone,
        "key": key,
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{api_url}/api/v1/schedules",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        result = response.json()
        return result["schedule_id"]


# Module-level instance for convenience
schedules = type(
    "Schedules",
    (),
    {
        "create": create,
    },
)()
