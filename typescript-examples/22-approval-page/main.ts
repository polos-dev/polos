/**
 * Approval Page Example — unified single-file usage.
 *
 * Starts a Polos instance (worker + client), runs a deployment workflow
 * that suspends for human approval. When it suspends, the script prints
 * an approval URL — open it in your browser to see the form, fill it
 * in, and click Submit. The workflow then resumes automatically with
 * the submitted data.
 *
 * Prerequisites:
 *   - Orchestrator + UI running (polos-server start)
 *
 * Run:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (default from env)
 *   POLOS_API_URL    - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY    - API key (optional for local development)
 */

import 'dotenv/config';
import { Polos } from '@polos/sdk';

// Import for side-effects: triggers global registry registration
import './workflow.js';

import { deployWorkflow } from './workflow.js';

async function main(): Promise<void> {
  const polos = new Polos({ deploymentId: 'approval-page-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    const apiUrl = process.env['POLOS_API_URL'] ?? 'http://localhost:8080';

    // Start the deployment workflow
    console.log('Starting deployment workflow...');
    const handle = await polos.invoke(deployWorkflow.id, {
      service: 'api-gateway',
      version: '2.4.0',
      environment: 'production',
    });
    console.log(`Execution ID: ${handle.id}`);

    // Stream events and wait for the suspend
    console.log('\nWaiting for workflow to reach approval step...\n');

    for await (const event of polos.events.streamWorkflow(handle.rootWorkflowId, handle.id)) {
      if (event.eventType?.startsWith('suspend_')) {
        const data = event.data as Record<string, unknown>;
        const approvalUrl = data['_approval_url'] as string | undefined;

        // The UI dev server runs on :5173 — rewrite the URL for local development.
        // In production the orchestrator serves the UI, so the URL works as-is.
        const uiBaseUrl = process.env['POLOS_UI_URL'] ?? 'http://localhost:5173';
        const stepKey = event.eventType.slice('suspend_'.length);
        const displayUrl = approvalUrl
          ? approvalUrl.replace(apiUrl, uiBaseUrl)
          : `${uiBaseUrl}/approve/${handle.id}/${stepKey}`;

        console.log('='.repeat(60));
        console.log('  Workflow suspended — waiting for approval');
        console.log('='.repeat(60));
        console.log(`\n  Open this URL in your browser:\n`);
        console.log(`  ${displayUrl}\n`);
        console.log('  Fill in the form and click Submit.');
        console.log('  The workflow will resume automatically.\n');
        console.log('  Waiting for response...');
      }

    }
    // The stream auto-closes on workflow_finish / agent_finish / tool_finish events.

    // Give the orchestrator a moment to finalize
    await new Promise((r) => setTimeout(r, 1000));

    const execution = await polos.getExecution(handle.id);

    console.log('\n' + '='.repeat(60));
    if (execution.status === 'completed') {
      const result = execution.result as Record<string, unknown>;
      console.log('  Workflow completed!');
      console.log(`  Service:     ${String(result['service'])}`);
      console.log(`  Version:     ${String(result['version'])}`);
      console.log(`  Environment: ${String(result['environment'])}`);
      console.log(`  Status:      ${String(result['status'])}`);
      console.log(`  Approved by: ${String(result['approvedBy'])}`);
      if (result['reason']) {
        console.log(`  Reason:      ${String(result['reason'])}`);
      }
    } else {
      console.log(`  Workflow ended with status: ${execution.status}`);
      if (execution.error) {
        console.log(`  Error: ${execution.error}`);
      }
    }
    console.log('='.repeat(60));
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
