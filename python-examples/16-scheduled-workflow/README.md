# Scheduled Workflows Example

This example demonstrates workflows that run on a schedule using cron expressions.

## Features

- Cron-based scheduling
- Timezone support
- Dynamic scheduling
- Disabling scheduling

## Use Cases

- Daily cleanup tasks
- Periodic reports
- Recurring data synchronization
- Scheduled notifications

## Files

- `workflows.py` - Scheduled workflow definitions
- `worker.py` - Worker that registers workflows

## Running the Example

1. Start the Polos server:
   ```bash
   polos server start
   ```

2. Install dependencies:
   ```bash
   # Using uv (recommended)
   uv sync

   # Or using pip
   pip install -e .
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

4. Run the worker:
   ```bash
   python worker.py
   ```

## Cron Expressions

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sun=0)
│ │ │ │ │
* * * * *
```

### Common Patterns

| Cron | Description |
|------|-------------|
| `0 * * * *` | Every hour |
| `0 0 * * *` | Daily at midnight |
| `0 8 * * *` | Daily at 8:00 AM |
| `0 8 * * 1-5` | Weekdays at 8:00 AM |
| `0 9 * * 1` | Mondays at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 1 * *` | First of each month |

## Schedule Configuration

### Simple Cron String

```python
@workflow(id="daily_cleanup", schedule="0 3 * * *")
async def daily_cleanup(ctx, payload):
    # Runs at 3:00 AM UTC every day
    pass
```

### With Timezone

```python
@workflow(
    id="morning_report",
    schedule={"cron": "0 8 * * 1-5", "timezone": "America/New_York"},
)
async def morning_report(ctx, payload):
    # Runs at 8:00 AM Eastern, Monday-Friday
    pass
```

### Dynamically Schedulable

```python
@workflow(id="reminder", schedule=True)
async def reminder(ctx, payload):
    # Can be scheduled via API, no fixed schedule
    pass
```

### Not Schedulable

```python
@workflow(id="one_time", schedule=False)
async def one_time(ctx, payload):
    # Cannot be scheduled, only invoked directly
    pass
```

## Schedule Payload

Scheduled workflows receive a payload with:

```python
{
    "timestamp": "2024-01-01T08:00:00Z",  # Scheduled execution time
    "schedule_id": "sched-123",            # Schedule identifier
}
```

## Timezones

Supported timezone identifiers (IANA format):

- `America/New_York`
- `America/Los_Angeles`
- `Europe/London`
- `Europe/Paris`
- `Asia/Tokyo`
- `UTC` (default)

## Best Practices

1. **Use UTC for internal processing** - Convert to local time only for display
2. **Idempotent operations** - Scheduled jobs may run more than once
3. **Error handling** - Implement proper error handling for reliability
4. **Logging** - Log start/end times for debugging
5. **Avoid overlaps** - Ensure previous run completes before next starts

## Monitoring Schedules

View scheduled workflows in the Polos UI:
- Active schedules
- Next run time
- Last run status
- Execution history
