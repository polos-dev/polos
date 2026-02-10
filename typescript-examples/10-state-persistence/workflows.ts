/**
 * State persistence examples.
 *
 * Demonstrates how workflows can maintain typed state that persists
 * across workflow executions and resumes.
 */

import { defineWorkflow } from '@polos/sdk';
import { z } from 'zod';

// ============================================================================
// State Schemas
// ============================================================================

export const CounterStateSchema = z.object({
  count: z.number().default(0),
  lastUpdated: z.string().nullable().default(null),
});

export type CounterState = z.infer<typeof CounterStateSchema>;

const ShoppingCartStateSchema = z.object({
  items: z.array(z.record(z.unknown())).default([]),
  total: z.number().default(0),
});

type ShoppingCartState = z.infer<typeof ShoppingCartStateSchema>;

// ============================================================================
// Counter Workflow
// ============================================================================

interface CounterPayload {
  action: 'increment' | 'decrement' | 'reset';
  amount?: number;
}

interface CounterResult {
  action: string;
  count: number;
  lastUpdated: string;
}

export const counterWorkflow = defineWorkflow<CounterPayload, CounterState, CounterResult>(
  { id: 'counter_workflow', stateSchema: CounterStateSchema },
  async (ctx, payload) => {
    const amount = payload.amount ?? 1;

    if (payload.action === 'increment') {
      ctx.state.count += amount;
    } else if (payload.action === 'decrement') {
      ctx.state.count -= amount;
    } else if (payload.action === 'reset') {
      ctx.state.count = 0;
    }

    ctx.state.lastUpdated = new Date().toISOString();

    return {
      action: payload.action,
      count: ctx.state.count,
      lastUpdated: ctx.state.lastUpdated,
    };
  },
);

// ============================================================================
// Shopping Cart Workflow
// ============================================================================

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CartPayload {
  action: 'add' | 'remove' | 'clear';
  item?: CartItem;
  itemId?: string;
}

interface CartResult {
  items: Record<string, unknown>[];
  total: number;
}

export const shoppingCartWorkflow = defineWorkflow<CartPayload, ShoppingCartState, CartResult>(
  { id: 'shopping_cart', stateSchema: ShoppingCartStateSchema },
  async (ctx, payload) => {
    if (payload.action === 'add' && payload.item) {
      const itemDict: Record<string, unknown> = {
        id: payload.item.id,
        name: payload.item.name,
        price: payload.item.price,
        quantity: payload.item.quantity,
      };
      ctx.state.items.push(itemDict);
      ctx.state.total += payload.item.price * payload.item.quantity;
    } else if (payload.action === 'remove' && payload.itemId) {
      const idx = ctx.state.items.findIndex(
        (item) => item['id'] === payload.itemId,
      );
      if (idx >= 0) {
        const item = ctx.state.items[idx]!;
        ctx.state.total -= (Number(item['price']) || 0) * (Number(item['quantity']) || 1);
        ctx.state.items.splice(idx, 1);
      }
    } else if (payload.action === 'clear') {
      ctx.state.items = [];
      ctx.state.total = 0;
    }

    return {
      items: ctx.state.items,
      total: ctx.state.total,
    };
  },
);

// ============================================================================
// Stateful with Initial State
// ============================================================================

interface InitialStatePayload {
  increment: number;
}

interface InitialStateResult {
  originalCount: number;
  newCount: number;
  lastUpdated: string;
}

export const statefulWithInitialState = defineWorkflow<
  InitialStatePayload,
  CounterState,
  InitialStateResult
>(
  { id: 'stateful_with_initial_state', stateSchema: CounterStateSchema },
  async (ctx, payload) => {
    const originalCount = ctx.state.count;

    ctx.state.count += payload.increment;
    ctx.state.lastUpdated = new Date().toISOString();

    return {
      originalCount,
      newCount: ctx.state.count,
      lastUpdated: ctx.state.lastUpdated,
    };
  },
);
