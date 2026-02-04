"""Suspend and resume workflow examples.

Demonstrates how workflows can pause execution and wait for external input
before continuing. Useful for:
- Human-in-the-loop approvals
- Waiting for external systems
- Multi-step user interactions
"""

from pydantic import BaseModel

from polos import workflow, WorkflowContext


# ============================================================================
# Approval Workflow Models
# ============================================================================


class ApprovalRequest(BaseModel):
    """Request for approval."""

    request_id: str
    requester: str
    description: str
    amount: float


class ApprovalDecision(BaseModel):
    """Decision from approver."""

    approved: bool
    approver: str
    comments: str | None = None


class ApprovalResult(BaseModel):
    """Result of approval workflow."""

    request_id: str
    status: str
    approved: bool | None = None
    approver: str | None = None
    comments: str | None = None


# ============================================================================
# Multi-Step Form Models
# ============================================================================


class PersonalInfo(BaseModel):
    """Personal information collected in step 1."""

    first_name: str
    last_name: str
    email: str


class AddressInfo(BaseModel):
    """Address information collected in step 2."""

    street: str
    city: str
    country: str


class Preferences(BaseModel):
    """User preferences collected in step 3."""

    newsletter: bool = False
    notifications: bool = True


class MultiStepFormPayload(BaseModel):
    """Input for multi-step form workflow."""

    form_id: str
    form_type: str = "registration"


class MultiStepFormResult(BaseModel):
    """Result from multi-step form workflow."""

    form_id: str
    status: str
    personal_info: PersonalInfo | None = None
    address_info: AddressInfo | None = None
    preferences: Preferences | None = None
    fields_count: int = 0


# ============================================================================
# Document Review Models
# ============================================================================


class ReviewFeedback(BaseModel):
    """Feedback from a single reviewer."""

    approved: bool
    comments: str | None = None
    rating: int | None = None  # 1-5 rating


class ReviewerResult(BaseModel):
    """Result from a single reviewer."""

    reviewer: str
    feedback: ReviewFeedback


class DocumentReviewPayload(BaseModel):
    """Input for document review workflow."""

    document_id: str
    document_title: str
    reviewers: list[str]


class DocumentReviewResult(BaseModel):
    """Result from document review workflow."""

    document_id: str
    document_title: str
    reviews: list[ReviewerResult]
    all_approved: bool
    status: str


# ============================================================================
# Approval Workflow
# ============================================================================


@workflow(id="approval_workflow")
async def approval_workflow(
    ctx: WorkflowContext, payload: ApprovalRequest
) -> ApprovalResult:
    """Workflow that suspends for human approval.

    1. Validates the request
    2. Suspends and waits for approval decision
    3. Processes based on decision
    """
    # Step 1: Validate and prepare request
    await ctx.step.run(
        "prepare_request",
        lambda: {"prepared": True, "request_id": payload.request_id},
    )

    # Step 2: Suspend and wait for approval
    # The workflow will pause here until resume is called
    suspend_data = {
        "request_id": payload.request_id,
        "requester": payload.requester,
        "description": payload.description,
        "amount": payload.amount,
        "message": "Please review and approve/reject this request",
    }

    # suspend() returns the data from the resume event
    resume_data = await ctx.step.suspend(
        "await_approval",
        data=suspend_data,
        timeout=86400,  # 24 hour timeout
    )

    # Step 3: Process the decision
    decision = ApprovalDecision.model_validate(resume_data.get("data", {}))

    if decision.approved:
        await ctx.step.run(
            "process_approval",
            lambda: {"action": "approved", "request_id": payload.request_id},
        )
        status = "approved"
    else:
        await ctx.step.run(
            "process_rejection",
            lambda: {"action": "rejected", "request_id": payload.request_id},
        )
        status = "rejected"

    return ApprovalResult(
        request_id=payload.request_id,
        status=status,
        approved=decision.approved,
        approver=decision.approver,
        comments=decision.comments,
    )


# ============================================================================
# Multi-Step Form Workflow
# ============================================================================


@workflow(id="multi_step_form")
async def multi_step_form(
    ctx: WorkflowContext, payload: MultiStepFormPayload
) -> MultiStepFormResult:
    """Multi-step form workflow that collects data across multiple suspends.

    Demonstrates chaining multiple suspend/resume steps.
    """
    # Step 1: Collect personal information
    step1_data = await ctx.step.suspend(
        "personal_info",
        data={
            "form_id": payload.form_id,
            "step": 1,
            "total_steps": 3,
            "prompt": "Please provide your personal information",
            "fields": ["first_name", "last_name", "email"],
        },
    )
    personal_info = PersonalInfo.model_validate(step1_data.get("data", {}))

    # Step 2: Collect address information
    step2_data = await ctx.step.suspend(
        "address_info",
        data={
            "form_id": payload.form_id,
            "step": 2,
            "total_steps": 3,
            "prompt": "Please provide your address",
            "fields": ["street", "city", "country"],
        },
    )
    address_info = AddressInfo.model_validate(step2_data.get("data", {}))

    # Step 3: Collect preferences
    step3_data = await ctx.step.suspend(
        "preferences",
        data={
            "form_id": payload.form_id,
            "step": 3,
            "total_steps": 3,
            "prompt": "Please select your preferences",
            "fields": ["newsletter", "notifications"],
        },
    )
    preferences = Preferences.model_validate(step3_data.get("data", {}))

    # Step 4: Process collected data
    fields_count = 3 + 3 + 2  # personal + address + preferences fields

    return MultiStepFormResult(
        form_id=payload.form_id,
        status="completed",
        personal_info=personal_info,
        address_info=address_info,
        preferences=preferences,
        fields_count=fields_count,
    )


# ============================================================================
# Document Review Workflow
# ============================================================================


@workflow(id="document_review")
async def document_review(
    ctx: WorkflowContext, payload: DocumentReviewPayload
) -> DocumentReviewResult:
    """Document review workflow with multiple reviewers.

    Suspends for each reviewer and collects all feedback.
    """
    reviews: list[ReviewerResult] = []

    for i, reviewer in enumerate(payload.reviewers):
        # Suspend for each reviewer
        review_data = await ctx.step.suspend(
            f"review_{i}_{reviewer}",
            data={
                "document_id": payload.document_id,
                "document_title": payload.document_title,
                "reviewer": reviewer,
                "reviewer_number": i + 1,
                "total_reviewers": len(payload.reviewers),
                "prompt": f"Please review document: {payload.document_title}",
                "fields": ["approved", "comments", "rating"],
            },
            timeout=172800,  # 48 hour timeout per reviewer
        )

        feedback = ReviewFeedback.model_validate(review_data.get("data", {}))
        reviews.append(ReviewerResult(reviewer=reviewer, feedback=feedback))

    # Aggregate reviews
    all_approved = all(r.feedback.approved for r in reviews)

    return DocumentReviewResult(
        document_id=payload.document_id,
        document_title=payload.document_title,
        reviews=reviews,
        all_approved=all_approved,
        status="approved" if all_approved else "needs_revision",
    )
