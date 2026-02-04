"""Scheduled workflow examples.

Demonstrates workflows that run on a schedule using cron expressions.
Scheduled workflows are useful for:
- Daily reports
- Periodic cleanup tasks
- Recurring data synchronization
- Scheduled notifications
"""

from datetime import datetime

from pydantic import BaseModel

from polos import workflow, WorkflowContext, schedules, SchedulePayload


# ============================================================================
# Result Models
# ============================================================================


class CleanupResult(BaseModel):
    """Result from cleanup workflow."""

    timestamp: datetime
    records_cleaned: int
    files_cleaned: int


class ReportResult(BaseModel):
    """Result from report workflow."""

    timestamp: datetime
    report_id: str
    metrics_count: int


class SyncResult(BaseModel):
    """Result from sync workflow."""

    timestamp: datetime
    records_synced: int


class ReminderResult(BaseModel):
    """Result from reminder workflow."""

    timestamp: datetime
    message: str
    sent: bool


# ============================================================================
# Scheduled Workflows
# ============================================================================


@workflow(id="daily_cleanup", schedule="0 3 * * *")
async def daily_cleanup(ctx: WorkflowContext, payload: SchedulePayload) -> CleanupResult:
    """Runs daily at 3:00 AM UTC.

    The schedule parameter accepts cron expressions:
    - minute hour day-of-month month day-of-week
    - 0 3 * * * = 3:00 AM every day

    Scheduled workflows receive a SchedulePayload with:
    - timestamp: When this run was scheduled
    - last_timestamp: When the schedule last ran
    - timezone: Schedule timezone
    - schedule_id: Unique identifier
    - key: User/entity key
    - upcoming: Next scheduled run time
    """
    # Clean up old data
    cleanup_result = await ctx.step.run(
        "cleanup_old_records",
        cleanup_old_records,
    )

    # Clean up temp files
    temp_result = await ctx.step.run(
        "cleanup_temp_files",
        cleanup_temp_files,
    )

    # Log completion
    await ctx.step.run(
        "log_cleanup",
        lambda: print(f"Daily cleanup completed at {payload.timestamp}"),
    )

    return CleanupResult(
        timestamp=payload.timestamp,
        records_cleaned=cleanup_result.get("count", 0),
        files_cleaned=temp_result.get("count", 0),
    )


def cleanup_old_records() -> dict:
    """Clean up old database records."""
    # In a real scenario, this would delete old records
    return {"count": 150, "status": "completed"}


def cleanup_temp_files() -> dict:
    """Clean up temporary files."""
    # In a real scenario, this would delete temp files
    return {"count": 25, "status": "completed"}


@workflow(
    id="morning_report",
    schedule={"cron": "0 8 * * 1-5", "timezone": "America/New_York"},
)
async def morning_report(ctx: WorkflowContext, payload: SchedulePayload) -> ReportResult:
    """Runs at 8:00 AM Eastern Time, Monday through Friday.

    Using a dict for schedule allows specifying timezone.
    - cron: "0 8 * * 1-5" = 8:00 AM, Monday-Friday
    - timezone: "America/New_York"
    """
    # Gather metrics
    metrics = await ctx.step.run(
        "gather_metrics",
        gather_daily_metrics,
    )

    # Generate report
    report = await ctx.step.run(
        "generate_report",
        generate_report,
        metrics,
    )

    # Send report
    await ctx.step.run(
        "send_report",
        send_report,
        report,
    )

    return ReportResult(
        timestamp=payload.timestamp,
        report_id=report.get("id"),
        metrics_count=len(metrics),
    )


def gather_daily_metrics() -> dict:
    """Gather daily metrics."""
    return {
        "active_users": 1250,
        "new_signups": 45,
        "revenue": 12500.00,
        "orders": 320,
    }


def generate_report(metrics: dict) -> dict:
    """Generate a report from metrics."""
    return {
        "id": "report-001",
        "metrics": metrics,
        "generated_at": datetime.now().isoformat(),
    }


def send_report(report: dict) -> dict:
    """Send the report."""
    return {"sent": True, "report_id": report.get("id")}


@workflow(id="hourly_sync", schedule="0 * * * *")
async def hourly_sync(ctx: WorkflowContext, payload: SchedulePayload) -> SyncResult:
    """Runs at the start of every hour.

    Cron: 0 * * * * = minute 0 of every hour
    """
    # Sync data from external source
    sync_result = await ctx.step.run(
        "sync_external_data",
        sync_external_data,
    )

    return SyncResult(
        timestamp=payload.timestamp,
        records_synced=sync_result.get("count", 0),
    )


def sync_external_data() -> dict:
    """Sync data from external source."""
    return {"count": 500, "status": "synced"}


@workflow(id="schedulable_reminder", schedule=True)
async def schedulable_reminder(
    ctx: WorkflowContext, payload: SchedulePayload
) -> ReminderResult:
    """A workflow that CAN be scheduled but has no default schedule.

    schedule=True means this workflow can be scheduled dynamically
    using the schedules API, but doesn't run on a fixed schedule.

    Use schedules.create() to add a schedule for this workflow.
    """
    # The payload contains schedule metadata when triggered by scheduler
    # or can be constructed manually for testing
    message = "Scheduled reminder!"

    await ctx.step.run(
        "send_reminder",
        lambda: print(f"Reminder at {payload.timestamp}: {message}"),
    )

    return ReminderResult(
        timestamp=payload.timestamp,
        message=message,
        sent=True,
    )
