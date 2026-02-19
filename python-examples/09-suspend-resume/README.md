# Suspend and Resume Example

This example demonstrates how workflows can suspend execution and wait for external input before continuing.

## Features

- Suspending workflows for human-in-the-loop interactions
- Resuming workflows with data from external sources
- Multi-step suspend/resume flows
- Timeout handling for suspended workflows
- Pydantic models for typed input/output

## Use Cases

- **Approval workflows** - Pause for manager approval
- **Multi-step forms** - Collect data across multiple interactions
- **Document review** - Wait for multiple reviewers
- **External integrations** - Wait for webhook callbacks

## Files

- `workflows.py` - Workflow definitions with suspend/resume
- `worker.py` - Worker that registers workflows
- `main.py` - Interactive demo client

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

4. Run the worker in one terminal:
   ```bash
   python worker.py
   ```

5. Run the interactive demo in another terminal:
   ```bash
   python main.py
   ```

## Interactive Demo

The `main.py` script provides an interactive demonstration of suspend/resume:

1. **Approval Workflow** - Submit a request, then approve or reject it
2. **Multi-Step Form** - Fill out a 3-step form with suspend between each step
3. **Document Review** - Simulate multiple reviewers providing feedback

The demo streams events to detect when the workflow suspends, prompts you for input, and resumes the workflow.

## Suspend/Resume Flow

```
1. Workflow starts
   │
2. ctx.step.suspend("await_approval", data={...})
   │
   └──> Workflow pauses, status becomes "waiting"
   │    Suspend event published to workflow/{root_workflow_id}/{root_execution_id}
   │    with event_type="suspend_await_approval"
   │
3. Client streams events via events.stream_workflow()
   │    and detects the suspend event
   │
4. Client collects user input
   │
5. Client calls client.resume(...)
   │    Resume event published to same topic
   │    with event_type="resume_await_approval"
   │
6. Orchestrator matches resume event to waiting execution
   │
7. Workflow resumes, suspend() returns the resume data
   │
8. Workflow continues to completion
```

## Workflow Examples

### Approval Workflow

```python
class ApprovalRequest(BaseModel):
    request_id: str
    requester: str
    description: str
    amount: float

class ApprovalDecision(BaseModel):
    approved: bool
    approver: str
    comments: str | None = None

class ApprovalResult(BaseModel):
    request_id: str
    status: str
    approved: bool | None = None
    approver: str | None = None

@workflow(id="approval_workflow")
async def approval_workflow(
    ctx: WorkflowContext, payload: ApprovalRequest
) -> ApprovalResult:
    # Prepare request
    await ctx.step.run("prepare", prepare_request, payload)

    # Suspend and wait for approval
    resume_data = await ctx.step.suspend(
        "await_approval",
        data={
            "request_id": payload.request_id,
            "message": "Please approve this request",
        },
        timeout=86400,  # 24 hour timeout
    )

    # Process the decision
    decision = ApprovalDecision.model_validate(resume_data.get("data", {}))

    return ApprovalResult(
        request_id=payload.request_id,
        status="approved" if decision.approved else "rejected",
        approved=decision.approved,
        approver=decision.approver,
    )
```

### Multi-Step Form

```python
class MultiStepFormPayload(BaseModel):
    form_id: str

class MultiStepFormResult(BaseModel):
    form_id: str
    status: str
    personal_info: PersonalInfo | None = None
    address_info: AddressInfo | None = None

@workflow(id="multi_step_form")
async def multi_step_form(
    ctx: WorkflowContext, payload: MultiStepFormPayload
) -> MultiStepFormResult:
    # Step 1: Personal info
    step1 = await ctx.step.suspend(
        "personal_info",
        data={"step": 1, "fields": ["first_name", "last_name", "email"]},
    )
    personal_info = PersonalInfo.model_validate(step1.get("data", {}))

    # Step 2: Address
    step2 = await ctx.step.suspend(
        "address_info",
        data={"step": 2, "fields": ["street", "city", "country"]},
    )
    address_info = AddressInfo.model_validate(step2.get("data", {}))

    return MultiStepFormResult(
        form_id=payload.form_id,
        status="completed",
        personal_info=personal_info,
        address_info=address_info,
    )
```

## Client-Side Resume

```python
from polos import PolosClient, events
from workflows import approval_workflow, ApprovalRequest

client = PolosClient(project_id="...", api_url="http://localhost:8080")

# Start workflow (returns ExecutionHandle immediately)
handle = await approval_workflow.invoke(
    client,
    ApprovalRequest(
        request_id="REQ-001",
        requester="alice@example.com",
        description="New laptop",
        amount=1500.00,
    ),
)

# Stream events to detect when the workflow suspends
suspend_data = None
async for event in events.stream_workflow(client, handle.root_workflow_id, handle.id):
    if event.event_type.startswith("suspend_"):
        suspend_data = event.data
        break

# Resume with user decision
await client.resume(
    suspend_workflow_id=handle.root_workflow_id,
    suspend_execution_id=handle.id,
    suspend_step_key="await_approval",
    data={"approved": True, "approver": "manager@example.com"},
)
```

## Suspend Data

When a workflow calls `ctx.step.suspend()`:

1. A suspend event is published to the shared workflow topic `workflow/{root_workflow_id}/{root_execution_id}` with:
   - `event_type` - `suspend_{step_key}` (e.g. `suspend_await_approval`)
   - `data` - The data dict passed to `suspend()`

2. A wait step is created with `wait_type="suspend"` (distinct from `wait_for_event()` which uses `wait_type="event"`). The orchestrator uses this to require `event_type="resume_{step_key}"` matching when resuming.

Clients detect suspend by streaming events and checking for `event_type.startswith("suspend_")`.

## Resume Data

When resuming, the data from the resume event is returned by `suspend()`:
```python
resume_data = await ctx.step.suspend("step_key", data={...})
# resume_data["data"] contains the data passed to client.resume()
```

## Timeout Handling

Suspends can have optional timeouts:
```python
# Suspend with 1-hour timeout
resume_data = await ctx.step.suspend(
    "await_input",
    data={"prompt": "Enter your response"},
    timeout=3600,  # seconds
)
```

If the timeout expires, the workflow will fail with a timeout error.

## Multiple Sequential Suspends

Workflows can have multiple sequential suspends:
```python
step1_data = await ctx.step.suspend("step_1", data={"step": 1})
step2_data = await ctx.step.suspend("step_2", data={"step": 2})
step3_data = await ctx.step.suspend("step_3", data={"step": 3})
```

Each suspend creates a new wait point. The orchestrator matches resume events by `event_type` (`resume_{step_key}`), so each suspend is resumed independently.