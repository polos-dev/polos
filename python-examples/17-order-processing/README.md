# Order Processing with Structured Output

Demonstrates order processing with:
- **Structured output** from LLM agent (action, action_details, action_requested)
- **Conditional fraud review** for orders > $1000
- **Human-in-the-loop** suspend/resume

## Flow

**Amount <= $1000:**
1. Agent charges customer via Stripe
2. Agent immediately sends confirmation email
3. Done

**Amount > $1000:**
1. Agent charges customer via Stripe
2. Agent returns `action_requested: "fraud_review"`
3. Workflow suspends for human review
4. If approved: Agent sends confirmation email
5. If rejected: Order cancelled

## Run

```bash
# Terminal 1: Start worker
python worker.py

# Terminal 2: Run workflow
python main.py
# Enter amount: 500 (no fraud review) or 1500 (fraud review)
```

## Approve/Reject Orders

When a workflow suspends for fraud review, use the utility:

```bash
# Approve
python approve_order.py <execution_id>

# Reject
python approve_order.py <execution_id> --reject
```

The execution ID is printed in the worker output when fraud review is required.

## Files

- `schemas.py` - Structured output schema (OrderAgentOutput)
- `agents.py` - LLM agent with output_schema
- `tools.py` - charge_stripe, send_confirmation_email
- `workflows.py` - Order processing with conditional fraud review
- `approve_order.py` - Utility to approve/reject pending orders
