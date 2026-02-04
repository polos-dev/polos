"""State persistence examples.

Demonstrates how workflows can maintain typed state that persists
across workflow executions and resumes.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from polos import workflow, WorkflowContext, WorkflowState


# ============================================================================
# State Schemas
# ============================================================================


class CounterState(WorkflowState):
    """Simple counter state."""

    count: int = 0
    last_updated: str | None = None


class ShoppingCartState(WorkflowState):
    """Shopping cart state."""

    items: list[dict[str, Any]] = Field(default_factory=list)
    total: float = 0.0


# ============================================================================
# Counter Workflow Models
# ============================================================================


class CounterPayload(BaseModel):
    """Input for counter workflow."""

    action: Literal["increment", "decrement", "reset"] = "increment"
    amount: int = 1


class CounterResult(BaseModel):
    """Result from counter workflow."""

    action: str
    count: int
    last_updated: str


# ============================================================================
# Shopping Cart Workflow Models
# ============================================================================


class CartItem(BaseModel):
    """Item in shopping cart."""

    id: str
    name: str
    price: float
    quantity: int = 1


class CartPayload(BaseModel):
    """Payload for shopping cart workflow.

    Actions:
    - add: Add an item to the cart (requires `item`)
    - remove: Remove an item from the cart (requires `item_id`)
    - clear: Clear all items from the cart
    """

    action: Literal["add", "remove", "clear"] = "add"
    item: CartItem | None = None  # For "add" action
    item_id: str | None = None  # For "remove" action


class CartResult(BaseModel):
    """Result from shopping cart workflow."""

    items: list[dict[str, Any]]
    total: float


# ============================================================================
# Stateful with Initial State Models
# ============================================================================


class InitialStatePayload(BaseModel):
    """Input for stateful_with_initial_state workflow."""

    increment: int = 1


class InitialStateResult(BaseModel):
    """Result from stateful_with_initial_state workflow."""

    original_count: int
    new_count: int
    last_updated: str


# ============================================================================
# Workflows
# ============================================================================


@workflow(id="counter_workflow", state_schema=CounterState)
async def counter_workflow(ctx: WorkflowContext, payload: CounterPayload) -> CounterResult:
    """Workflow with counter state."""
    if payload.action == "increment":
        ctx.state.count += payload.amount
    elif payload.action == "decrement":
        ctx.state.count -= payload.amount
    elif payload.action == "reset":
        ctx.state.count = 0

    ctx.state.last_updated = datetime.now().isoformat()

    return CounterResult(
        action=payload.action,
        count=ctx.state.count,
        last_updated=ctx.state.last_updated,
    )


@workflow(id="shopping_cart", state_schema=ShoppingCartState)
async def shopping_cart_workflow(ctx: WorkflowContext, payload: CartPayload) -> CartResult:
    """Shopping cart workflow with persistent state.

    Demonstrates a stateful workflow for e-commerce scenarios.
    """
    if payload.action == "add" and payload.item:
        item_dict = payload.item.model_dump()
        ctx.state.items.append(item_dict)
        ctx.state.total += payload.item.price * payload.item.quantity

    elif payload.action == "remove" and payload.item_id:
        for i, item in enumerate(ctx.state.items):
            if item.get("id") == payload.item_id:
                ctx.state.total -= item.get("price", 0) * item.get("quantity", 1)
                ctx.state.items.pop(i)
                break

    elif payload.action == "clear":
        ctx.state.items = []
        ctx.state.total = 0.0

    return CartResult(
        items=ctx.state.items,
        total=ctx.state.total,
    )


@workflow(id="stateful_with_initial_state", state_schema=CounterState)
async def stateful_with_initial_state(ctx: WorkflowContext, payload: InitialStatePayload) -> InitialStateResult:
    """Workflow that can be invoked with initial state.

    When invoking this workflow, you can pass initial_state to set
    the starting state values.
    """
    # State is already initialized (from initial_state or defaults)
    original_count = ctx.state.count

    # Modify state
    ctx.state.count += payload.increment
    ctx.state.last_updated = datetime.now().isoformat()

    return InitialStateResult(
        original_count=original_count,
        new_count=ctx.state.count,
        last_updated=ctx.state.last_updated,
    )
