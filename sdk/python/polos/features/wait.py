"""
Wait API for pausing workflow execution and resuming later.

This allows workflows to wait for time periods or subworkflows without consuming compute resources.
"""

from datetime import datetime, timedelta, timezone

import httpx

from ..runtime.client import _config, _get_headers


async def _set_waiting(
    execution_id: str,
    wait_until: datetime | None,
    wait_type: str,
    step_key: str,
    wait_topic: str | None = None,
    expires_at: datetime | None = None,
) -> None:
    """Internal method to set execution to waiting state."""
    api_url = _config["api_url"]
    headers = _get_headers()

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{api_url}/internal/executions/{execution_id}/wait",
            json={
                "wait_until": wait_until.isoformat() if wait_until else None,
                "wait_type": wait_type,
                "step_key": step_key,
                "wait_topic": wait_topic,
                "expires_at": expires_at.isoformat() if expires_at else None,
            },
            headers=headers,
        )
        response.raise_for_status()


async def _get_wait_time(
    seconds: float | None = None,
    minutes: float | None = None,
    hours: float | None = None,
    days: float | None = None,
    weeks: float | None = None,
):
    # Calculate wait_until datetime using proper date arithmetic
    # Use timezone-aware UTC datetime
    now = datetime.now(timezone.utc)
    wait_until = now

    if seconds:
        wait_until = wait_until + timedelta(seconds=seconds)
    if minutes:
        wait_until = wait_until + timedelta(minutes=minutes)
    if hours:
        wait_until = wait_until + timedelta(hours=hours)
    if days:
        wait_until = wait_until + timedelta(days=days)
    if weeks:
        wait_until = wait_until + timedelta(weeks=weeks)

    # Calculate total seconds for threshold check
    total_seconds = (wait_until - now).total_seconds()

    return total_seconds, wait_until


class WaitException(BaseException):
    """
    Exception raised when workflow execution must pause to wait.

    This is used internally for checkpointing and should not be
    caught by user code (inherits from BaseException to prevent this).
    """

    def __init__(self, reason: str, wait_data: dict | None = None):
        self.reason = reason
        self.wait_data = wait_data or {}
        super().__init__(reason)
