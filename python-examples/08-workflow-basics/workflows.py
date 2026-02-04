"""Basic workflow examples demonstrating workflow decorator and step operations.

Workflows are durable functions that can:
- Execute steps that are automatically retried on failure
- Wait for time durations or events
- Invoke other workflows (child workflows)
- Maintain state across executions
"""

from pydantic import BaseModel

from polos import workflow, WorkflowContext


# ============================================================================
# Pydantic Models for Workflow Input/Output
# ============================================================================


class SimplePayload(BaseModel):
    """Input for simple workflow."""

    name: str = "World"


class SimpleResult(BaseModel):
    """Result from simple workflow."""

    message: str


class OrderPayload(BaseModel):
    """Input for order processing workflow."""

    order_id: str
    customer_email: str
    items: list[str]
    total_amount: float


class OrderResult(BaseModel):
    """Result from order processing workflow."""

    order_id: str
    status: str
    confirmation_number: str


class DataPipelinePayload(BaseModel):
    """Input for data pipeline workflow."""

    data: list[str | int | float]


class AggregatedData(BaseModel):
    """Aggregated data from processing."""

    count: int
    items: list[str | int | float]


class DataPipelineResult(BaseModel):
    """Result from data pipeline workflow."""

    result: AggregatedData


class TimedPayload(BaseModel):
    """Input for timed workflow."""

    pass  # No input needed, but using model for consistency


class TimedResult(BaseModel):
    """Result from timed workflow."""

    status: str
    start_time: int
    end_time: int
    duration_ms: int


class RandomPayload(BaseModel):
    """Input for random workflow."""

    pass  # No input needed, but using model for consistency


class RandomResult(BaseModel):
    """Result from random workflow."""

    random_value: float
    random_id: str
    coin_flip: str


class ItemData(BaseModel):
    """Data for an item to be validated and enriched."""

    id: int
    name: str
    value: int | float


class ValidateEnrichPayload(BaseModel):
    """Input for validate and enrich workflow."""

    data: dict
    validation_type: str = "basic"


class EnrichedData(BaseModel):
    """Enriched data with additional fields."""

    _enriched: bool = True
    _source: str = "validate_and_enrich_workflow"

    class Config:
        extra = "allow"  # Allow additional fields from original data


class ValidateEnrichResult(BaseModel):
    """Result from validate and enrich workflow."""

    valid: bool
    original: dict | None = None
    enriched: dict | None = None
    timestamp: int | None = None
    error: str | None = None


class PreparationStatus(BaseModel):
    """Preparation status from parent workflow."""

    status: str
    item_count: int


class ParentPayload(BaseModel):
    """Input for parent workflow."""

    items: list[ItemData]


class ParentResult(BaseModel):
    """Result from parent workflow."""

    preparation: PreparationStatus
    total_items: int
    valid_items: int
    results: list[ValidateEnrichResult]


class OrchestratorPayload(BaseModel):
    """Input for orchestrator workflow."""

    data: dict


class ProcessedData(BaseModel):
    """Processed data from orchestrator workflow."""

    processed: bool
    data: dict
    processing_applied: list[str]


class OrchestratorResult(BaseModel):
    """Result from orchestrator workflow."""

    status: str
    output_id: str | None = None
    stage: str | None = None
    error: str | None = None
    enrichment: ValidateEnrichResult | None = None
    processed: ProcessedData | None = None


# ============================================================================
# Simple Workflow
# ============================================================================


@workflow
async def simple_workflow(ctx: WorkflowContext, payload: SimplePayload) -> SimpleResult:
    """A simple workflow that processes data.

    The @workflow decorator registers this function as a Polos workflow.
    It receives a WorkflowContext and a typed payload.
    """
    # Use ctx.step.run to execute a step with automatic retry
    greeting = await ctx.step.run(
        "generate_greeting",  # Step key - must be unique
        lambda: f"Hello, {payload.name}!",  # Function to execute
    )

    return SimpleResult(message=greeting)


# ============================================================================
# Order Processing Workflow
# ============================================================================


@workflow(id="order_processor")
async def process_order(ctx: WorkflowContext, payload: OrderPayload) -> OrderResult:
    """Process an order with multiple steps.

    This workflow demonstrates:
    - Using Pydantic models for typed input/output
    - Multiple sequential steps
    - Custom workflow ID
    """
    # Step 1: Validate order
    await ctx.step.run(
        "validate_order",
        validate_order_data,
        payload,
    )

    # Step 2: Reserve inventory
    await ctx.step.run(
        "reserve_inventory",
        reserve_inventory,
        payload.items,
    )

    # Step 3: Process payment
    await ctx.step.run(
        "process_payment",
        process_payment,
        payload.total_amount,
    )

    # Step 4: Generate confirmation number (deterministic via step)
    confirmation = await ctx.step.uuid("confirmation_number")

    # Step 5: Send confirmation email
    await ctx.step.run(
        "send_confirmation",
        send_confirmation_email,
        payload.customer_email,
        confirmation,
    )

    return OrderResult(
        order_id=payload.order_id,
        status="completed",
        confirmation_number=confirmation,
    )


# Helper functions for the order workflow
def validate_order_data(payload: OrderPayload) -> bool:
    """Validate order data."""
    if not payload.items:
        raise ValueError("Order must have at least one item")
    if payload.total_amount <= 0:
        raise ValueError("Total amount must be positive")
    return True


def reserve_inventory(items: list[str]) -> dict:
    """Reserve inventory for items."""
    return {"reserved": items, "status": "reserved"}


def process_payment(amount: float) -> dict:
    """Process payment."""
    return {"amount": amount, "status": "paid"}


def send_confirmation_email(email: str, confirmation: str) -> dict:
    """Send confirmation email."""
    return {"email": email, "confirmation": confirmation, "sent": True}


# ============================================================================
# Data Pipeline Workflow
# ============================================================================


@workflow(id="data_pipeline")
async def data_pipeline(
    ctx: WorkflowContext, payload: DataPipelinePayload
) -> DataPipelineResult:
    """A data processing pipeline with parallel-capable steps.

    Demonstrates step.run with custom retry configuration.
    """
    # Step with custom retry settings
    processed = await ctx.step.run(
        "process_data",
        process_data,
        payload.data,
        max_retries=5,  # More retries for unreliable operations
        base_delay=2.0,  # Longer delay between retries
        max_delay=30.0,  # Cap on exponential backoff
    )

    # Aggregate results
    aggregated = await ctx.step.run(
        "aggregate_results",
        aggregate,
        processed,
    )

    return DataPipelineResult(result=AggregatedData(**aggregated))


def process_data(data: list) -> list:
    """Process data items."""
    return [item.upper() if isinstance(item, str) else item * 2 for item in data]


def aggregate(data: list) -> dict:
    """Aggregate processed data."""
    return {"count": len(data), "items": data}


# ============================================================================
# Timed Workflow
# ============================================================================


@workflow(id="timed_workflow")
async def timed_workflow(ctx: WorkflowContext, payload: TimedPayload) -> TimedResult:
    """Workflow that demonstrates waiting and time-based operations."""
    # Get current timestamp (deterministic via step)
    start_time = await ctx.step.now("start_time")

    # Simulate some work
    result = await ctx.step.run(
        "initial_work",
        lambda: {"status": "processing"},
    )

    # Wait for a short duration (useful for rate limiting, etc.)
    await ctx.step.wait_for("cooldown", seconds=5)

    # Do more work after waiting
    final_status = await ctx.step.run(
        "final_work",
        lambda: "completed",
    )

    end_time = await ctx.step.now("end_time")

    return TimedResult(
        status=final_status,
        start_time=start_time,
        end_time=end_time,
        duration_ms=end_time - start_time,
    )


# ============================================================================
# Random Workflow
# ============================================================================


@workflow(id="random_workflow")
async def random_workflow(ctx: WorkflowContext, payload: RandomPayload) -> RandomResult:
    """Workflow demonstrating deterministic random values.

    ctx.step.random() returns the same value on replay/resume.
    """
    # Generate random values (deterministic across replays)
    random_value = await ctx.step.random("random_value")
    random_id = await ctx.step.uuid("random_id")

    # Use random value for decision making
    coin_flip = "heads" if random_value > 0.5 else "tails"

    return RandomResult(
        random_value=random_value,
        random_id=random_id,
        coin_flip=coin_flip,
    )


# ============================================================================
# Child Workflow Examples
# ============================================================================


@workflow(id="validate_and_enrich")
async def validate_and_enrich(
    ctx: WorkflowContext, payload: ValidateEnrichPayload
) -> ValidateEnrichResult:
    """A child workflow that validates and enriches data.

    This workflow is designed to be invoked by a parent workflow.
    """
    # Step 1: Validate the data
    is_valid = await ctx.step.run(
        "validate_data",
        validate_data,
        payload.data,
        payload.validation_type,
    )

    if not is_valid:
        return ValidateEnrichResult(
            valid=False,
            original=payload.data,
            error="Validation failed",
        )

    # Step 2: Enrich the data with additional info
    enriched = await ctx.step.run(
        "enrich_data",
        enrich_data,
        payload.data,
    )

    # Step 3: Add timestamp
    timestamp = await ctx.step.now("enrichment_timestamp")

    return ValidateEnrichResult(
        valid=True,
        original=payload.data,
        enriched=enriched,
        timestamp=timestamp,
    )


def validate_data(data: dict, validation_type: str) -> bool:
    """Validate data based on type."""
    if validation_type == "strict":
        return bool(data and all(v is not None for v in data.values()))
    return bool(data)


def enrich_data(data: dict) -> dict:
    """Enrich data with additional fields."""
    return {
        **data,
        "_enriched": True,
        "_source": "validate_and_enrich_workflow",
    }


@workflow(id="parent_workflow")
async def parent_workflow(
    ctx: WorkflowContext, payload: ParentPayload
) -> ParentResult:
    """Parent workflow that invokes child workflows.

    Demonstrates:
    - ctx.step.invoke_and_wait() to call child workflow and wait for result
    - Passing data between parent and child workflows
    - Using child workflow results in parent
    """
    results: list[ValidateEnrichResult] = []

    # Step 1: Do some initial work
    preparation = await ctx.step.run(
        "prepare_data",
        lambda: PreparationStatus(status="prepared", item_count=len(payload.items)),
    )

    # Step 2: Invoke child workflow for each item and wait for results
    for i, item in enumerate(payload.items):
        # Invoke child workflow and wait for it to complete
        child_result = await ctx.step.invoke_and_wait(
            f"validate_item_{i}",
            validate_and_enrich,  # Child workflow
            ValidateEnrichPayload(data=item.model_dump(), validation_type="basic"),
        )
        results.append(child_result)

    # Step 3: Aggregate results
    valid_count = sum(1 for r in results if r.valid)

    return ParentResult(
        preparation=preparation,
        total_items=len(payload.items),
        valid_items=valid_count,
        results=results,
    )


@workflow(id="orchestrator_workflow")
async def orchestrator_workflow(
    ctx: WorkflowContext, payload: OrchestratorPayload
) -> OrchestratorResult:
    """Orchestrator workflow demonstrating sequential child workflow calls.

    This pattern is useful for:
    - Breaking complex workflows into reusable pieces
    - Coordinating multiple workflows in sequence
    - Building workflow pipelines
    """
    # Step 1: First, validate and enrich the data using child workflow
    enrichment_result = await ctx.step.invoke_and_wait(
        "enrich_data",
        validate_and_enrich,
        ValidateEnrichPayload(data=payload.data, validation_type="strict"),
    )

    if not enrichment_result.valid:
        return OrchestratorResult(
            status="failed",
            stage="enrichment",
            error=enrichment_result.error,
        )

    # Step 2: Process the enriched data
    processed = await ctx.step.run(
        "process_enriched",
        lambda enriched: ProcessedData(
            processed=True,
            data=enriched,
            processing_applied=["normalize", "dedupe"],
        ),
        enrichment_result.enriched or {},
    )

    # Step 3: Generate final output
    output_id = await ctx.step.uuid("output_id")

    return OrchestratorResult(
        status="completed",
        output_id=output_id,
        enrichment=enrichment_result,
        processed=processed,
    )
