/**
 * Order processing workflow with structured output and fraud review.
 *
 * Demonstrates:
 * - Agent invocation with structured output
 * - Conditional fraud review (suspend/resume) for high-value orders
 * - Human-in-the-loop pattern
 *
 * Flow:
 *   Amount <= $1000: Agent charges + sends confirmation immediately
 *   Amount > $1000:  Agent charges, requests fraud review, workflow suspends,
 *                    then sends confirmation on approval
 */

import { defineWorkflow } from '@polos/sdk';
import { orderAgent } from './agents.js';
import type { OrderAgentOutput } from './schemas.js';

// ============================================================================
// Payload / Result Types
// ============================================================================

export interface OrderPayload {
  orderId: string;
  customerId: string;
  customerEmail: string;
  amount: number;
}

export interface OrderResult {
  orderId: string;
  status: string;
  chargeId: string | null;
  fraudReviewRequired: boolean;
  fraudApproved: boolean | null;
  emailSent: boolean;
}

// ============================================================================
// Order Processing Workflow
// ============================================================================

export const orderProcessingWorkflow = defineWorkflow<OrderPayload, unknown, OrderResult>(
  { id: 'order_processing_workflow' },
  async (ctx, payload) => {
    // Step 1: Process the payment
    const result = (await ctx.step.agentInvokeAndWait(
      'start_order',
      orderAgent.withInput(
        `Process payment for order ${payload.orderId}. ` +
        `Charge customer ${payload.customerId} for $${payload.amount.toFixed(2)} USD. ` +
        `Customer email is ${payload.customerEmail}.`,
      ),
    )) as Record<string, unknown>;

    const output = result['result'] as OrderAgentOutput;
    const chargeId = output.action_details.charge_id;

    // Step 2: Check if fraud review is requested
    if (output.action_requested === 'fraud_review') {
      const executionId = ctx.rootExecutionId ?? ctx.executionId;

      await ctx.step.run(
        'log_fraud_review',
        () => {
          console.log('\n' + '*'.repeat(60));
          console.log('*** FRAUD REVIEW REQUIRED ***');
          console.log('*** To approve: npx tsx approve_order.ts ' + executionId);
          console.log('*** To reject:  npx tsx approve_order.ts ' + executionId + ' --reject');
          console.log('*'.repeat(60) + '\n');
        },
      );

      // Suspend for human fraud review
      const resumeData = await ctx.step.suspend<Record<string, unknown>, Record<string, unknown>>(
        'fraud_review',
        {
          data: {
            order_id: payload.orderId,
            customer_id: payload.customerId,
            amount: payload.amount,
            charge_id: chargeId,
            message: 'Please review this order for fraud (amount > $1000)',
          },
          timeout: 86400,
        },
      );

      const fraudApproved = Boolean(
        (resumeData?.['data'] as Record<string, unknown> | undefined)?.['approved'] ?? false,
      );

      if (!fraudApproved) {
        console.log('\n--- Order rejected by fraud review ---');
        return {
          orderId: payload.orderId,
          status: 'rejected',
          chargeId,
          fraudReviewRequired: true,
          fraudApproved: false,
          emailSent: false,
        };
      }

      // Step 3: Fraud approved - tell agent to send confirmation
      const confirmResult = (await ctx.step.agentInvokeAndWait(
        'send_confirmation',
        orderAgent.withInput(
          `Fraud review APPROVED for order ${payload.orderId}. ` +
          `Charge ID: ${chargeId ?? 'unknown'}, Amount: $${payload.amount.toFixed(2)}. ` +
          `Now send confirmation email to ${payload.customerEmail}.`,
        ),
      )) as Record<string, unknown>;

      const confirmOutput = confirmResult['result'] as OrderAgentOutput;
      console.log(`Agent action: ${confirmOutput.action}`);
      console.log(`Status: ${confirmOutput.status_message}`);

      return {
        orderId: payload.orderId,
        status: 'completed',
        chargeId,
        fraudReviewRequired: true,
        fraudApproved: true,
        emailSent: true,
      };
    }

    // No fraud review needed - agent already sent confirmation
    console.log('\n--- Order completed (no fraud review needed) ---');
    return {
      orderId: payload.orderId,
      status: 'completed',
      chargeId,
      fraudReviewRequired: false,
      fraudApproved: null,
      emailSent: true,
    };
  },
);
