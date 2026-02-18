/**
 * Order Processing Example — unified single-file usage.
 *
 * Starts a Polos instance (worker + client), runs the order processing
 * workflow, and handles fraud review for high-value orders.
 *
 * - Amount <= $1000: Charges and sends confirmation immediately
 * - Amount > $1000: Charges, waits for fraud review, then sends confirmation
 *
 * Run:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (default from env)
 *   POLOS_API_URL    - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY    - API key for authentication (optional for local development)
 *   OPENAI_API_KEY   - OpenAI API key (required for the agent)
 */

import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Polos } from '@polos/sdk';

// Import for side-effects: triggers global registry registration
import './schemas.js';
import './tools.js';
import './agents.js';
import './workflows.js';

import { orderProcessingWorkflow } from './workflows.js';
import type { OrderPayload } from './workflows.js';

const rl = readline.createInterface({ input, output });

async function main(): Promise<void> {
  const polos = new Polos({ deploymentId: 'order-processing-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    // Get order amount from user
    console.log('='.repeat(50));
    console.log('Order Processing Demo');
    console.log('='.repeat(50));
    console.log('  <= $1000: No fraud review (immediate confirmation)');
    console.log('  >  $1000: Requires fraud review before confirmation');
    console.log('='.repeat(50));

    const amountStr = (await rl.question('\nEnter order amount (e.g., 500 or 1500): $')).trim();
    const amount = amountStr ? Number(amountStr) : 99.99;

    const payload: OrderPayload = {
      orderId: 'ORD-12345',
      customerId: 'cust_abc123',
      customerEmail: 'customer@example.com',
      amount,
    };

    console.log(`\nOrder ID: ${payload.orderId}`);
    console.log(`Customer: ${payload.customerId}`);
    console.log(`Amount: $${payload.amount.toFixed(2)}`);
    console.log(`Fraud review: ${amount > 1000 ? 'Required' : 'Not required'}`);

    // Start the workflow
    console.log('\n' + '-'.repeat(50));
    console.log('Starting workflow...');
    const handle = await polos.invoke(orderProcessingWorkflow.id, payload);
    console.log(`Execution ID: ${handle.id}`);

    // If amount > $1000, wait for fraud review suspend
    if (amount > 1000) {
      for await (const event of polos.events.streamWorkflow(handle.rootWorkflowId, handle.id)) {
        if (event.eventType?.startsWith('suspend_')) {
          const data = event.data;
          console.log('\n' + '*'.repeat(50));
          console.log('*** FRAUD REVIEW REQUIRED ***');
          console.log('*'.repeat(50));
          console.log(`Order ID: ${String(data['order_id'])}`);
          console.log(`Customer: ${String(data['customer_id'])}`);
          console.log(`Amount: $${Number(data['amount']).toFixed(2)}`);
          console.log(`Charge ID: ${String(data['charge_id'])}`);
          console.log('*'.repeat(50));
          break;
        }
      }
    }

    // Wait for completion
    console.log('\nWaiting...');
    while (true) {
      await new Promise((r) => setTimeout(r, 500));
      const execution = await polos.getExecution(handle.id);
      if (execution.status === 'completed' || execution.status === 'failed') {
        console.log('\n' + '='.repeat(50));
        console.log('WORKFLOW COMPLETED');
        console.log('='.repeat(50));
        const result = (execution.result ?? {}) as Record<string, unknown>;
        console.log(`Status: ${execution.status}`);
        console.log(`Charge ID: ${String(result['chargeId'])}`);
        console.log(`Fraud Review Required: ${String(result['fraudReviewRequired'])}`);
        console.log(`Fraud Approved: ${String(result['fraudApproved'])}`);
        console.log(`Email Sent: ${String(result['emailSent'])}`);
        console.log('='.repeat(50));
        break;
      }
    }
  } finally {
    rl.close();
    await polos.stop();
  }
}

main().catch(console.error);
