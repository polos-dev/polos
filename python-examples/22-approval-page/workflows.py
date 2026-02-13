"""A workflow that requests approval via a web UI before proceeding.

When it reaches the approval step, it suspends with _form metadata
that the Polos UI renders as an interactive form. The suspend event
also includes _approval_url so the client knows where to send the user.
"""

from pydantic import BaseModel

from polos import workflow, WorkflowContext


class DeployRequest(BaseModel):
    service: str
    version: str
    environment: str


class DeployResult(BaseModel):
    service: str
    version: str
    environment: str
    status: str
    approved_by: str | None = None
    reason: str | None = None


@workflow(id="deploy_with_approval")
async def deploy_workflow(ctx: WorkflowContext, payload: DeployRequest) -> DeployResult:
    # Step 1: Run pre-deploy checks
    checks = await ctx.step.run(
        "pre_deploy_checks",
        lambda: {
            "tests_pass": True,
            "build_success": True,
            "service": payload.service,
            "version": payload.version,
        },
    )

    # Step 2: Suspend and wait for human approval via the web UI.
    # The _form schema tells the approval page what to render.
    resume_data = await ctx.step.suspend(
        "approve_deploy",
        data={
            "_form": {
                "title": f"Deploy {payload.service} v{payload.version}",
                "description": (
                    f"Approve deployment to {payload.environment}. "
                    "All pre-deploy checks passed."
                ),
                "fields": [
                    {
                        "name": "approved",
                        "type": "boolean",
                        "label": "Approve this deployment",
                        "default": False,
                    },
                    {
                        "name": "approver",
                        "type": "text",
                        "label": "Your name",
                        "required": True,
                    },
                    {
                        "name": "reason",
                        "type": "textarea",
                        "label": "Comments",
                        "description": "Optional reason or notes for this decision",
                    },
                ],
                "context": {
                    "service": payload.service,
                    "version": payload.version,
                    "environment": payload.environment,
                    "tests": "passing" if checks["tests_pass"] else "failing",
                    "build": "success" if checks["build_success"] else "failed",
                },
            },
        },
        timeout=86400,  # 24 hour timeout
    )

    # Step 3: Process the decision
    decision = resume_data.get("data", resume_data) if isinstance(resume_data, dict) else {}
    approved = bool(decision.get("approved"))
    approved_by = str(decision.get("approver", "unknown"))
    reason = str(decision["reason"]) if decision.get("reason") is not None else None

    if approved:
        await ctx.step.run(
            "execute_deploy",
            lambda: {"deployed": True},
        )

    return DeployResult(
        service=payload.service,
        version=payload.version,
        environment=payload.environment,
        status="deployed" if approved else "rejected",
        approved_by=approved_by,
        reason=reason,
    )
