/**
 * Tools for order processing.
 */

import { defineTool, type WorkflowContext } from '@polos/sdk';
import { z } from 'zod';

// ============================================================================
// Charge Stripe Tool
// ============================================================================

const chargeStripeInputSchema = z.object({
  customer_id: z.string(),
  amount: z.number(),
  currency: z.string().default('usd'),
});

const chargeStripeOutputSchema = z.object({
  charge_id: z.string(),
  status: z.string(),
  amount: z.number(),
  currency: z.string(),
});

type ChargeStripeInput = z.infer<typeof chargeStripeInputSchema>;
type ChargeStripeOutput = z.infer<typeof chargeStripeOutputSchema>;

export const chargeStripe = defineTool(
  {
    id: 'charge_stripe',
    description: 'Charge a customer using Stripe payment processing',
    inputSchema: chargeStripeInputSchema,
    outputSchema: chargeStripeOutputSchema,
  },
  async (_ctx: WorkflowContext, input: ChargeStripeInput): Promise<ChargeStripeOutput> => {
    console.log('\n' + '*'.repeat(50));
    console.log('*** CHARGING CUSTOMER VIA STRIPE ***');
    console.log(`*** Customer: ${input.customer_id}`);
    console.log(`*** Amount: $${input.amount.toFixed(2)} ${input.currency.toUpperCase()}`);
    console.log('*** Processing payment...');
    console.log('*** Payment successful!');
    console.log('*'.repeat(50) + '\n');

    return {
      charge_id: `ch_${input.customer_id}_001`,
      status: 'succeeded',
      amount: input.amount,
      currency: input.currency,
    };
  },
);

// ============================================================================
// Send Confirmation Email Tool
// ============================================================================

const sendEmailInputSchema = z.object({
  email: z.string(),
  order_id: z.string(),
  amount: z.number(),
});

const sendEmailOutputSchema = z.object({
  sent: z.boolean(),
  message_id: z.string(),
});

type SendEmailInput = z.infer<typeof sendEmailInputSchema>;
type SendEmailOutput = z.infer<typeof sendEmailOutputSchema>;

export const sendConfirmationEmail = defineTool(
  {
    id: 'send_confirmation_email',
    description: 'Send order confirmation email to customer',
    inputSchema: sendEmailInputSchema,
    outputSchema: sendEmailOutputSchema,
  },
  async (_ctx: WorkflowContext, input: SendEmailInput): Promise<SendEmailOutput> => {
    console.log('\n' + '*'.repeat(50));
    console.log('*** SENDING CONFIRMATION EMAIL ***');
    console.log(`*** To: ${input.email}`);
    console.log(`*** Order: ${input.order_id}`);
    console.log(`*** Amount: $${input.amount.toFixed(2)}`);
    console.log('*** Email sent successfully!');
    console.log('*'.repeat(50) + '\n');

    return {
      sent: true,
      message_id: `msg_${input.order_id}_001`,
    };
  },
);
