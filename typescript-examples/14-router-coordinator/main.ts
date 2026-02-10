/**
 * Client demonstrating the Blog Review workflow with agent orchestration.
 *
 * Run the worker first:
 *   npx tsx worker.ts
 *
 * Then run this client:
 *   npx tsx main.ts
 *
 * Environment variables:
 *   POLOS_PROJECT_ID - Your project ID (required)
 *   POLOS_API_URL - Orchestrator URL (default: http://localhost:8080)
 *   POLOS_API_KEY - API key for authentication (optional for local development)
 */

import 'dotenv/config';
import { PolosClient } from '@polos/sdk';
import { generateBlog, blogReview } from './workflows.js';
import type { GenerateBlogPayload, BlogReviewPayload } from './workflows.js';

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function demoGenerateBlog(client: PolosClient): Promise<void> {
  printHeader('Generate Blog Demo');
  console.log('This workflow:');
  console.log('  1. Generates a blog post using the blog_generator agent');
  console.log('  2. Sends the draft through blog_review workflow which:');
  console.log('     - Runs 3 review agents in parallel (grammar, tone, correctness)');
  console.log('     - Calls final_editor agent to produce polished version');

  const topic = 'The benefits of taking short breaks during work';
  const additionalInstructions = 'Keep it casual and relatable. Include practical tips.';

  printSection('Invoking generate_blog workflow');
  console.log(`  Topic: ${topic}`);
  console.log(`  Instructions: ${additionalInstructions}`);

  // Invoke the workflow
  const handle = await client.invoke('generate_blog', {
    topic,
    additionalInstructions,
  } satisfies GenerateBlogPayload);

  console.log(`\n  Workflow started with execution ID: ${handle.id}`);
  console.log('\n  Streaming events...');
  console.log('-'.repeat(60));

  // Stream workflow events and print agent_finish and workflow_finish events
  for await (const event of client.events.streamWorkflow(handle.rootWorkflowId, handle.rootExecutionId)) {
    const eventType = event.eventType;

    if (eventType === 'agent_finish') {
      const metadata = (event.data['_metadata'] as Record<string, unknown>) ?? {};
      const agentId = (metadata['workflow_id'] as string) ?? 'unknown';
      const output = event.data['result'];
      console.log(`\n[AGENT FINISH] ${agentId}`);
      console.log(`  Output: ${JSON.stringify(output, null, 2)}`);
    } else if (eventType === 'workflow_finish') {
      const metadata = (event.data['_metadata'] as Record<string, unknown>) ?? {};
      const workflowId = (metadata['workflow_id'] as string) ?? 'unknown';
      console.log(`\n[WORKFLOW FINISH] ${workflowId}`);
      const result = event.data['result'] ?? {};
      console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
    } else if (eventType === 'step_start') {
      const stepName = (event.data['step_key'] as string) ?? 'unknown';
      console.log(`\n[STEP START] ${stepName}`);
    } else if (eventType === 'step_finish') {
      const stepName = (event.data['step_key'] as string) ?? 'unknown';
      console.log(`\n[STEP FINISH] ${stepName}`);
    }
  }
}

async function demoBlogReviewOnly(client: PolosClient): Promise<void> {
  printHeader('Blog Review Only Demo');
  console.log('This workflow reviews existing text through:');
  console.log('  1. Grammar reviewer (parallel)');
  console.log('  2. Tone reviewer (parallel)');
  console.log('  3. Correctness reviewer (parallel)');
  console.log('  4. Final editor (aggregates feedback)');

  const sampleText = `Artficial Inteligence is revolutionizing how we work. Many companys are adopting AI tools
to boost productivity. Studies show that AI can increase efficiency by over 500%!

However, its important to remember that AI is just a tool. It works best when humans
and machines collaborate together. The future of work is'nt about replacing humans,
its about augmenting our capabilties.`;

  printSection('Invoking blog_review workflow');
  console.log('  Text: (contains intentional errors for demonstration)');

  // Invoke the workflow
  const handle = await client.invoke('blog_review', {
    text: sampleText.trim(),
  } satisfies BlogReviewPayload);

  console.log(`\n  Workflow started with execution ID: ${handle.id}`);
  console.log('\n  Streaming events...');
  console.log('-'.repeat(60));

  // Stream workflow events
  for await (const event of client.events.streamWorkflow(handle.rootWorkflowId, handle.rootExecutionId)) {
    const eventType = event.eventType;

    if (eventType === 'agent_finish') {
      const metadata = (event.data['_metadata'] as Record<string, unknown>) ?? {};
      const agentId = (metadata['workflow_id'] as string) ?? 'unknown';
      const output = event.data['result'] ?? {};
      console.log(`\n[AGENT FINISH] ${agentId}`);
      console.log(`  Output: ${JSON.stringify(output, null, 2)}`);
    } else if (eventType === 'workflow_finish') {
      const metadata = (event.data['_metadata'] as Record<string, unknown>) ?? {};
      const workflowId = (metadata['workflow_id'] as string) ?? 'unknown';
      console.log(`\n[WORKFLOW FINISH] ${workflowId}`);
      console.log(`  Result: ${JSON.stringify(event.data['result'] ?? {}, null, 2)}`);
    }
  }
}

async function main(): Promise<void> {
  const projectId = process.env['POLOS_PROJECT_ID'];
  if (!projectId) {
    throw new Error(
      'POLOS_PROJECT_ID environment variable is required. ' +
        'Set it to your project ID (e.g., export POLOS_PROJECT_ID=my-project). ' +
        'You can get this from the output printed by `polos-server start` or from the UI page at ' +
        "http://localhost:5173/projects/settings (the ID will be below the project name 'default')",
    );
  }

  const client = new PolosClient({
    projectId,
    apiUrl: process.env['POLOS_API_URL'] ?? 'http://localhost:8080',
    apiKey: process.env['POLOS_API_KEY'] ?? '',
  });

  console.log('='.repeat(60));
  console.log('Blog Review Workflow Examples');
  console.log('='.repeat(60));
  console.log('\nMake sure the worker is running: npx tsx worker.ts');
  console.log('\nThis demo showcases agent orchestration patterns:');
  console.log('  1. Generate blog - creates and reviews a blog post');
  console.log('  2. Blog review only - reviews existing text');

  try {
    // Demo 1: Generate and review a blog
    await demoGenerateBlog(client);

    // Demo 2: Review existing text
    await demoBlogReviewOnly(client);

    console.log('\n' + '='.repeat(60));
    console.log('All demos completed!');
    console.log('='.repeat(60));
  } catch (e) {
    console.log(`\nError: ${String(e)}`);
    console.log('\nMake sure the worker is running and try again.');
  }
}

main().catch(console.error);
