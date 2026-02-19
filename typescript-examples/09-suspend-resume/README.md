# Suspend and Resume Example

This example demonstrates how workflows can suspend execution and wait for external input before continuing.

## Features

- Suspending workflows for human-in-the-loop interactions
- Resuming workflows with data from external sources
- Multi-step suspend/resume flows
- Timeout handling for suspended workflows

## Use Cases

- **Approval workflows** - Pause for manager approval
- **Multi-step forms** - Collect data across multiple interactions
- **Document review** - Wait for multiple reviewers

## Files

- `workflows.ts` - Workflow definitions with suspend/resume
- `main.ts` - Starts Polos and runs the interactive suspend/resume demo

## Running the Example

1. Start the Polos server:
   ```bash
   polos server start
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your project ID
   ```

4. Run the example:
   ```bash
   npx tsx main.ts
   ```

## Suspend/Resume Flow

```
1. Workflow starts
2. ctx.step.suspend("await_approval", { data: {...} })
   └── Workflow pauses, status becomes "waiting"
3. Client streams events via client.events.streamWorkflow()
   └── Detects suspend event
4. Client collects user input
5. Client calls client.resume(...)
   └── Resume event published
6. Workflow resumes, suspend() returns the resume data
7. Workflow continues to completion
```

## Workflow Examples

### Approval Workflow

```typescript
const approvalWorkflow = defineWorkflow<ApprovalRequest, unknown, ApprovalResult>(
  { id: 'approval_workflow' },
  async (ctx, payload) => {
    await ctx.step.run('prepare', () => ({ prepared: true }));

    const resumeData = await ctx.step.suspend('await_approval', {
      data: { requestId: payload.requestId, message: 'Please approve' },
      timeout: 86400,
    });

    const decision = resumeData.data;
    return {
      requestId: payload.requestId,
      status: decision.approved ? 'approved' : 'rejected',
    };
  },
);
```

### Client-Side Resume

```typescript
const handle = await polos.invoke(approvalWorkflow.id, payload);

// Stream events to detect suspension
for await (const event of polos.events.streamWorkflow(handle.rootWorkflowId, handle.id)) {
  if (event.eventType?.startsWith('suspend_')) {
    break; // Workflow is suspended
  }
}

// Resume with user decision
await polos.resume(
  handle.rootWorkflowId,
  handle.id,
  'await_approval',
  { approved: true, approver: 'manager@example.com' },
);
```
