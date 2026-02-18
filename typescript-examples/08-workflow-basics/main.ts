/**
 * Demonstrate workflow execution including child workflow invocation.
 *
 * Run with:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 */

import 'dotenv/config';
import { Polos } from '@polos/sdk';
import {
  simpleWorkflow,
  dataPipeline,
  randomWorkflow,
  parentWorkflow,
  orchestratorWorkflow,
} from './workflows.js';

async function runWorkflowDemos() {
  const polos = new Polos({ deploymentId: 'workflow-basics-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    console.log('='.repeat(60));
    console.log('Workflow Basics Demo');
    console.log('='.repeat(60));

    // Demo 1: Simple workflow
    console.log('\n[Demo 1] Simple Workflow');
    console.log('-'.repeat(40));
    console.log("Running simple_workflow with name='Alice'...");

    try {
      const handle = await polos.invoke(simpleWorkflow.id, { name: 'Alice' });
      const result = await handle.getResult();
      console.log(`Result: ${JSON.stringify(result)}`);
    } catch (e) {
      console.log(`Error: ${String(e)}`);
    }

    // Demo 2: Data pipeline with custom retry
    console.log('\n[Demo 2] Data Pipeline');
    console.log('-'.repeat(40));
    console.log('Running data_pipeline with list of strings...');

    try {
      const handle = await polos.invoke(dataPipeline.id, {
        data: ['hello', 'world', 'workflow'],
      });
      const result = await handle.getResult();
      console.log(`Result: ${JSON.stringify(result)}`);
    } catch (e) {
      console.log(`Error: ${String(e)}`);
    }

    // Demo 3: Random workflow (deterministic)
    console.log('\n[Demo 3] Random Workflow');
    console.log('-'.repeat(40));
    console.log('Running random_workflow (coin flip)...');

    try {
      const handle = await polos.invoke(randomWorkflow.id, {});
      const result = await handle.getResult();
      console.log(`Result: ${JSON.stringify(result)}`);
    } catch (e) {
      console.log(`Error: ${String(e)}`);
    }

    // Demo 4: Parent workflow with child invocation
    console.log('\n[Demo 4] Parent Workflow with Child Workflows');
    console.log('-'.repeat(40));
    console.log('Running parent_workflow that invokes validate_and_enrich for each item...');

    try {
      const handle = await polos.invoke(parentWorkflow.id, {
        items: [
          { id: 1, name: 'Item A', value: 100 },
          { id: 2, name: 'Item B', value: 200 },
          { id: 3, name: 'Item C', value: 300 },
        ],
      });
      const result = (await handle.getResult()) as {
        totalItems: number;
        validItems: number;
        preparation: { status: string; itemCount: number };
        results: { valid: boolean; enriched?: { _enriched?: boolean } }[];
      };
      console.log(`Total items: ${String(result.totalItems)}`);
      console.log(`Valid items: ${String(result.validItems)}`);
      console.log(
        `Preparation: status=${result.preparation.status}, count=${String(result.preparation.itemCount)}`,
      );
      console.log('Child workflow results:');
      result.results.forEach((r, i) => {
        const enrichedFlag = r.enriched?._enriched;
        console.log(`  Item ${String(i + 1)}: valid=${String(r.valid)}, enriched=${String(enrichedFlag)}`);
      });
    } catch (e) {
      console.log(`Error: ${String(e)}`);
    }

    // Demo 5: Orchestrator workflow (sequential child calls)
    console.log('\n[Demo 5] Orchestrator Workflow');
    console.log('-'.repeat(40));
    console.log('Running orchestrator_workflow that coordinates child workflows...');

    try {
      const handle = await polos.invoke(orchestratorWorkflow.id, {
        data: { user_id: 'user-123', action: 'signup', email: 'user@example.com' },
      });
      const result = (await handle.getResult()) as {
        status: string;
        outputId?: string;
        enrichment?: { valid: boolean };
        processed?: { processingApplied: string[] };
      };
      console.log(`Status: ${result.status}`);
      console.log(`Output ID: ${String(result.outputId)}`);
      if (result.enrichment) {
        console.log(`Enrichment valid: ${String(result.enrichment.valid)}`);
      }
      if (result.processed) {
        console.log(`Processing applied: ${JSON.stringify(result.processed.processingApplied)}`);
      }
    } catch (e) {
      console.log(`Error: ${String(e)}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Demo complete!');
    console.log('='.repeat(60));
  } finally {
    await polos.stop();
  }
}

runWorkflowDemos().catch(console.error);
