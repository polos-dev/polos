"""Parallel review workflow examples.

Demonstrates how to run multiple workflows in parallel and aggregate results.
Useful for scenarios like:
- Multi-reviewer document review
- Parallel data processing
- Fan-out/fan-in patterns
"""

from pydantic import BaseModel

from polos import workflow, WorkflowContext
from polos.types.types import BatchWorkflowInput


class ReviewRequest(BaseModel):
    """Request for a single review."""

    reviewer_id: str
    document_id: str
    content: str


class ReviewResult(BaseModel):
    """Result from a single review."""

    reviewer_id: str
    document_id: str
    approved: bool
    score: int  # 1-10
    comments: str


class AggregatedReview(BaseModel):
    """Aggregated result from multiple reviews."""

    document_id: str
    total_reviews: int
    approved_count: int
    average_score: float
    all_approved: bool
    reviews: list[dict]


@workflow(id="single_review")
async def single_review(ctx: WorkflowContext, payload: ReviewRequest) -> ReviewResult:
    """Individual review workflow.

    This is invoked in parallel for each reviewer.
    """
    # Simulate review analysis
    result = await ctx.step.run(
        "analyze_document",
        analyze_document,
        payload.document_id,
        payload.content,
    )

    # Generate review decision
    review = await ctx.step.run(
        "generate_review",
        generate_review,
        payload.reviewer_id,
        result,
    )

    return ReviewResult(
        reviewer_id=payload.reviewer_id,
        document_id=payload.document_id,
        approved=review["approved"],
        score=review["score"],
        comments=review["comments"],
    )


def analyze_document(document_id: str, content: str) -> dict:
    """Analyze document content."""
    return {
        "document_id": document_id,
        "word_count": len(content.split()),
        "quality_score": 8,  # Simulated
    }


def generate_review(reviewer_id: str, analysis: dict) -> dict:
    """Generate a review based on analysis."""
    score = analysis.get("quality_score", 5)
    return {
        "approved": score >= 6,
        "score": score,
        "comments": f"Review by {reviewer_id}: Quality score {score}/10",
    }


@workflow(id="parallel_review")
async def parallel_review(ctx: WorkflowContext, payload: dict) -> AggregatedReview:
    """Run multiple reviews in parallel and aggregate results.

    Uses batch_invoke_and_wait to run all reviews concurrently.
    """
    document_id = payload.get("document_id", "doc-1")
    content = payload.get("content", "Sample document content")
    reviewers = payload.get("reviewers", ["alice", "bob", "charlie"])

    # Create batch of review requests
    review_requests = [
        BatchWorkflowInput(
            id="single_review",
            payload=ReviewRequest(
                reviewer_id=reviewer,
                document_id=document_id,
                content=content,
            ),
        )
        for reviewer in reviewers
    ]

    # Run all reviews in parallel and wait for all to complete
    results = await ctx.step.batch_invoke_and_wait(
        "parallel_reviews",
        review_requests,
    )

    # Aggregate results
    reviews = []
    approved_count = 0
    total_score = 0

    for batch_result in results:
        if batch_result.success and batch_result.result:
            review = batch_result.result
            reviews.append({
                "reviewer_id": review.reviewer_id,
                "approved": review.approved,
                "score": review.score,
                "comments": review.comments,
            })
            if review.approved:
                approved_count += 1
            total_score += review.score

    total_reviews = len(reviews)
    average_score = total_score / total_reviews if total_reviews > 0 else 0
    all_approved = approved_count == total_reviews

    return AggregatedReview(
        document_id=document_id,
        total_reviews=total_reviews,
        approved_count=approved_count,
        average_score=average_score,
        all_approved=all_approved,
        reviews=reviews,
    )


@workflow(id="data_chunk_processor")
async def data_chunk_processor(ctx: WorkflowContext, payload: dict) -> dict:
    """Process data in parallel chunks.

    Demonstrates fan-out/fan-in pattern for data processing.
    """
    data = payload.get("data", [])
    chunk_size = payload.get("chunk_size", 10)

    # Split data into chunks
    chunks = [data[i : i + chunk_size] for i in range(0, len(data), chunk_size)]

    # Create batch of chunk processing requests
    chunk_requests = [
        BatchWorkflowInput(
            id="process_chunk",
            payload={"chunk": chunk, "chunk_index": i},
        )
        for i, chunk in enumerate(chunks)
    ]

    # Process all chunks in parallel
    results = await ctx.step.batch_invoke_and_wait(
        "parallel_chunks",
        chunk_requests,
    )

    # Aggregate results
    all_processed = []
    for batch_result in results:
        if batch_result.success and batch_result.result:
            all_processed.extend(batch_result.result.get("processed", []))

    return {
        "total_items": len(data),
        "chunks_processed": len(results),
        "processed_items": len(all_processed),
        "results": all_processed,
    }


@workflow(id="process_chunk")
async def process_chunk(ctx: WorkflowContext, payload: dict) -> dict:
    """Process a single chunk of data."""
    chunk = payload.get("chunk", [])
    chunk_index = payload.get("chunk_index", 0)

    processed = await ctx.step.run(
        f"process_items_{chunk_index}",
        lambda items: [item.upper() if isinstance(item, str) else item * 2 for item in items],
        chunk,
    )

    return {
        "chunk_index": chunk_index,
        "processed": processed,
    }


@workflow(id="fire_and_forget_batch")
async def fire_and_forget_batch(ctx: WorkflowContext, payload: dict) -> dict:
    """Launch multiple workflows without waiting for results.

    Uses batch_invoke to start workflows and return immediately.
    """
    tasks = payload.get("tasks", [])

    # Create batch of task requests
    task_requests = [
        BatchWorkflowInput(
            id="background_task",
            payload={"task_id": task.get("id"), "data": task.get("data")},
        )
        for task in tasks
    ]

    # Launch all tasks in parallel (non-blocking)
    handles = await ctx.step.batch_invoke(
        "launch_background_tasks",
        task_requests,
    )

    # Return execution IDs for tracking
    return {
        "launched": len(handles),
        "execution_ids": [h.id for h in handles],
    }


@workflow(id="background_task")
async def background_task(ctx: WorkflowContext, payload: dict) -> dict:
    """Background task for fire-and-forget pattern."""
    task_id = payload.get("task_id")
    data = payload.get("data", {})

    result = await ctx.step.run(
        "execute_task",
        lambda: {"task_id": task_id, "status": "completed"},
    )

    return result
