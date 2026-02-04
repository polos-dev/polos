"""Error handling examples for workflows.

Demonstrates how to handle errors, retries, and failures in workflows.
"""

import random
from pydantic import BaseModel

from polos import workflow, WorkflowContext, StepExecutionError


class RetryPayload(BaseModel):
    """Payload for retry example."""

    failure_rate: float = 0.5  # Probability of failure (0-1)
    operation: str = "process"


@workflow(id="retry_example")
async def retry_example(ctx: WorkflowContext, payload: RetryPayload) -> dict:
    """Demonstrate automatic retry behavior.

    Steps are automatically retried with exponential backoff.
    """
    # This step may fail but will be retried
    result = await ctx.step.run(
        "unreliable_operation",
        unreliable_operation,
        payload.failure_rate,
        payload.operation,
        max_retries=3,  # Retry up to 3 times
        base_delay=1.0,  # Start with 1 second delay
        max_delay=10.0,  # Cap at 10 seconds
    )

    return {
        "status": "success",
        "result": result,
    }


def unreliable_operation(failure_rate: float, operation: str) -> dict:
    """Simulates an unreliable operation that may fail."""
    if random.random() < failure_rate:
        raise Exception(f"Random failure in {operation}")
    return {"operation": operation, "success": True}


@workflow(id="error_recovery")
async def error_recovery(ctx: WorkflowContext, payload: dict) -> dict:
    """Demonstrate error recovery patterns.

    Shows how to handle errors gracefully and continue processing.
    """
    results = []
    errors = []

    items = payload.get("items", ["item1", "item2", "item3"])

    for i, item in enumerate(items):
        try:
            # Attempt to process each item
            result = await ctx.step.run(
                f"process_{item}",
                process_item,
                item,
            )
            results.append(result)
        except StepExecutionError as e:
            # Log the error but continue with other items
            errors.append({
                "item": item,
                "error": str(e),
            })

    return {
        "processed": len(results),
        "failed": len(errors),
        "results": results,
        "errors": errors,
    }


def process_item(item: str) -> dict:
    """Process an item (may fail for certain items)."""
    if "fail" in item.lower():
        raise ValueError(f"Cannot process item: {item}")
    return {"item": item, "status": "processed"}


@workflow(id="fallback_pattern")
async def fallback_pattern(ctx: WorkflowContext, payload: dict) -> dict:
    """Demonstrate fallback pattern for error handling.

    Try primary method, fall back to secondary if primary fails.
    """
    data = payload.get("data", {})

    # Try primary method
    try:
        result = await ctx.step.run(
            "primary_method",
            primary_process,
            data,
            max_retries=2,
        )
        return {"method": "primary", "result": result}
    except StepExecutionError:
        pass  # Fall through to fallback

    # Try fallback method
    try:
        result = await ctx.step.run(
            "fallback_method",
            fallback_process,
            data,
            max_retries=2,
        )
        return {"method": "fallback", "result": result}
    except StepExecutionError as e:
        return {"method": "none", "error": str(e)}


def primary_process(data: dict) -> dict:
    """Primary processing method (may fail)."""
    if data.get("force_failure"):
        raise Exception("Primary method failed")
    return {"processed": data, "method": "primary"}


def fallback_process(data: dict) -> dict:
    """Fallback processing method (more reliable)."""
    return {"processed": data, "method": "fallback", "degraded": True}


@workflow(id="circuit_breaker")
async def circuit_breaker(ctx: WorkflowContext, payload: dict) -> dict:
    """Demonstrate circuit breaker pattern.

    Track failures and skip processing if too many failures occur.
    """
    items = payload.get("items", [])
    failure_threshold = payload.get("failure_threshold", 3)

    results = []
    failures = 0
    circuit_open = False

    for i, item in enumerate(items):
        if circuit_open:
            results.append({
                "item": item,
                "status": "skipped",
                "reason": "circuit_open",
            })
            continue

        try:
            result = await ctx.step.run(
                f"process_{i}",
                process_with_circuit_breaker,
                item,
                max_retries=1,
            )
            results.append(result)
            failures = 0  # Reset on success
        except StepExecutionError:
            failures += 1
            results.append({
                "item": item,
                "status": "failed",
            })

            if failures >= failure_threshold:
                circuit_open = True

    return {
        "results": results,
        "circuit_open": circuit_open,
        "total_failures": failures,
    }


def process_with_circuit_breaker(item: dict) -> dict:
    """Process item with potential failure."""
    if item.get("should_fail"):
        raise Exception(f"Failed to process: {item}")
    return {"item": item, "status": "success"}


@workflow(id="compensation_pattern")
async def compensation_pattern(ctx: WorkflowContext, payload: dict) -> dict:
    """Demonstrate compensation (rollback) pattern.

    If a step fails, run compensation steps to undo previous work.
    """
    completed_steps = []

    try:
        # Step 1: Reserve inventory
        await ctx.step.run("reserve_inventory", reserve_inventory, payload)
        completed_steps.append("reserve_inventory")

        # Step 2: Charge payment
        await ctx.step.run("charge_payment", charge_payment, payload)
        completed_steps.append("charge_payment")

        # Step 3: Send confirmation (may fail)
        await ctx.step.run("send_confirmation", send_confirmation, payload)
        completed_steps.append("send_confirmation")

        return {"status": "success", "completed": completed_steps}

    except StepExecutionError as e:
        # Run compensation for completed steps in reverse order
        for step in reversed(completed_steps):
            compensation_func = get_compensation(step)
            if compensation_func:
                await ctx.step.run(
                    f"compensate_{step}",
                    compensation_func,
                    payload,
                )

        return {
            "status": "rolled_back",
            "error": str(e),
            "compensated": reversed(completed_steps),
        }


def reserve_inventory(payload: dict) -> dict:
    """Reserve inventory."""
    return {"reserved": True}


def charge_payment(payload: dict) -> dict:
    """Charge payment."""
    return {"charged": True}


def send_confirmation(payload: dict) -> dict:
    """Send confirmation (may fail)."""
    if payload.get("fail_confirmation"):
        raise Exception("Failed to send confirmation")
    return {"sent": True}


def get_compensation(step: str):
    """Get compensation function for a step."""
    compensations = {
        "reserve_inventory": lambda p: {"released": True},
        "charge_payment": lambda p: {"refunded": True},
    }
    return compensations.get(step)
