/**
 * Structured output schemas for order processing.
 */

import { z } from 'zod';

export const actionDetailsSchema = z.object({
  charge_id: z.string().nullable().default(null).describe('Stripe charge ID if payment was made'),
  amount: z.number().nullable().default(null).describe('Amount charged or to be charged'),
  email_sent_to: z.string().nullable().default(null).describe('Email address if confirmation was sent'),
  message_id: z.string().nullable().default(null).describe('Email message ID if sent'),
});

export type ActionDetails = z.infer<typeof actionDetailsSchema>;

export const orderAgentOutputSchema = z.object({
  action: z.string().describe("Action taken: 'charge', 'email', or 'complete'"),
  action_details: actionDetailsSchema.describe('Details about the action'),
  action_requested: z.string().nullable().default(null).describe(
    "Next action requested: 'fraud_review' for amounts over $1000, or null",
  ),
  status_message: z.string().describe('Human-readable status message'),
});

export type OrderAgentOutput = z.infer<typeof orderAgentOutputSchema>;
