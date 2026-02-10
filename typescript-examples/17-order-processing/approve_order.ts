/**
 * Utility to approve or reject an order pending fraud review.
 *
 * Usage:
 *   npx tsx approve_order.ts <execution_id>
 *   npx tsx approve_order.ts <execution_id> --reject
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 */

import 'dotenv/config';
import { PolosClient } from '@polos/sdk';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: npx tsx approve_order.ts <execution_id> [--reject]');
    process.exit(1);
  }

  const executionId = args[0]!;
  const approved = !args.includes('--reject');

  const projectId = process.env['POLOS_PROJECT_ID'];
  if (!projectId) {
    throw new Error(
      'POLOS_PROJECT_ID environment variable is required. ' +
        'Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project).',
    );
  }

  const client = new PolosClient({
    projectId,
    apiUrl: process.env['POLOS_API_URL'] ?? 'http://localhost:8080',
    apiKey: process.env['POLOS_API_KEY'] ?? '',
  });

  console.log(`${approved ? 'Approving' : 'Rejecting'} order...`);
  console.log(`  Execution ID: ${executionId}`);

  await client.resume(
    'order_processing_workflow',
    executionId,
    'fraud_review',
    { approved },
  );

  console.log(`Done! Order ${approved ? 'approved' : 'rejected'}.`);
}

main().catch(console.error);
