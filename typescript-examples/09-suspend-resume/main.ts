/**
 * Interactive demo for suspend/resume workflows.
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
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Polos } from '@polos/sdk';
import type { ExecutionHandle } from '@polos/sdk';
import { approvalWorkflow, multiStepForm, documentReview } from './workflows.js';

const rl = readline.createInterface({ input, output });

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function ask(prompt: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || defaultValue || '';
}

async function askYesNo(prompt: string): Promise<boolean> {
  while (true) {
    const answer = (await rl.question(`${prompt} (y/n): `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    console.log("Please enter 'y' or 'n'");
  }
}

async function askChoice(prompt: string, options: string[]): Promise<number> {
  console.log(`\n${prompt}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${String(i + 1)}. ${options[i]}`);
  }
  while (true) {
    const answer = (await rl.question('\nEnter your choice: ')).trim();
    const num = Number(answer);
    if (num >= 1 && num <= options.length) return num;
    console.log(`Please enter a number between 1 and ${String(options.length)}`);
  }
}

async function waitForSuspend(
  polos: Polos,
  handle: ExecutionHandle,
): Promise<Record<string, unknown> | undefined> {
  for await (const event of polos.events.streamWorkflow(handle.rootWorkflowId, handle.id)) {
    if (event.eventType?.startsWith('suspend_')) {
      return event.data;
    }
  }
  return undefined;
}

async function runApprovalWorkflow(polos: Polos): Promise<void> {
  printHeader('Approval Workflow Demo');

  console.log('\nEnter approval request details:');
  const requestId = await ask('  Request ID', 'REQ-001');
  const requester = await ask('  Requester email', 'alice@example.com');
  const description = await ask('  Description', 'Purchase new equipment');
  const amount = Number(await ask('  Amount', '1500.00'));

  printSection('Starting workflow');
  console.log(`Starting approval workflow for request: ${requestId}`);

  const handle = await polos.invoke(approvalWorkflow.id, {
    requestId,
    requester,
    description,
    amount,
  });
  console.log(`Execution ID: ${handle.id}`);
  console.log('Workflow will suspend and wait for approval...');

  console.log(`\nStreaming events for workflow: ${handle.rootWorkflowId}`);
  const suspendData = await waitForSuspend(polos, handle);

  if (!suspendData) {
    console.log('Did not receive suspend event');
    return;
  }

  console.log('\nReceived suspend event!');
  console.log(`  Request ID: ${String(suspendData['request_id'])}`);
  console.log(`  Requester: ${String(suspendData['requester'])}`);
  console.log(`  Description: ${String(suspendData['description'])}`);
  console.log(`  Amount: $${Number(suspendData['amount']).toFixed(2)}`);
  console.log(`  Message: ${String(suspendData['message'])}`);

  printSection('Enter Approval Decision');
  const approved = await askYesNo('Do you approve this request?');
  const approver = await ask('Your email', 'manager@example.com');
  const comments = await ask('Comments (optional)');

  printSection('Resuming workflow');
  await polos.resume(handle.rootWorkflowId, handle.id, 'await_approval', {
    approved,
    approver,
    comments: comments || undefined,
  });
  console.log('Resume event published!');

  await new Promise((r) => setTimeout(r, 2000));
  const execution = await polos.getExecution(handle.id);

  if (execution.status === 'completed') {
    printSection('Workflow Completed');
    const result = execution.result as Record<string, unknown>;
    console.log(`  Status: ${String(result['status'])}`);
    console.log(`  Approved: ${String(result['approved'])}`);
    console.log(`  Approver: ${String(result['approver'])}`);
    if (result['comments']) {
      console.log(`  Comments: ${String(result['comments'])}`);
    }
  } else {
    console.log(`Final status: ${execution.status}`);
  }
}

async function runMultiStepForm(polos: Polos): Promise<void> {
  printHeader('Multi-Step Form Workflow Demo');

  const formId = await ask('\nForm ID', 'FORM-001');

  printSection('Starting workflow');
  console.log(`Starting multi-step form: ${formId}`);

  const handle = await polos.invoke(multiStepForm.id, { formId });
  console.log(`Execution ID: ${handle.id}`);

  const steps: [string, string, string[]][] = [
    ['personal_info', 'Personal Information', ['first_name', 'last_name', 'email']],
    ['address_info', 'Address Information', ['street', 'city', 'country']],
    ['preferences', 'Preferences', ['newsletter', 'notifications']],
  ];

  for (const [stepKey, stepName] of steps) {
    console.log(`\nWaiting for step: ${stepName}`);

    const suspendData = await waitForSuspend(polos, handle);
    if (suspendData) {
      console.log(`\n  Step ${String(suspendData['step'])} of ${String(suspendData['total_steps'])}`);
      console.log(`  ${String(suspendData['prompt'])}`);
    }

    let resumeData: Record<string, unknown>;

    if (stepKey === 'personal_info') {
      console.log('\nEnter personal information:');
      resumeData = {
        first_name: await ask('  First name', 'John'),
        last_name: await ask('  Last name', 'Doe'),
        email: await ask('  Email', 'john.doe@example.com'),
      };
    } else if (stepKey === 'address_info') {
      console.log('\nEnter address information:');
      resumeData = {
        street: await ask('  Street', '123 Main St'),
        city: await ask('  City', 'San Francisco'),
        country: await ask('  Country', 'USA'),
      };
    } else {
      console.log('\nEnter preferences:');
      resumeData = {
        newsletter: await askYesNo('  Subscribe to newsletter?'),
        notifications: await askYesNo('  Enable notifications?'),
      };
    }

    console.log(`\nSubmitting ${stepName}...`);
    await polos.resume(handle.rootWorkflowId, handle.id, stepKey, resumeData);
    console.log('Resume event published!');
  }

  await new Promise((r) => setTimeout(r, 2000));
  const execution = await polos.getExecution(handle.id);

  if (execution.status === 'completed') {
    printSection('Form Completed');
    const result = execution.result as Record<string, unknown>;
    console.log(`  Form ID: ${String(result['formId'])}`);
    console.log(`  Status: ${String(result['status'])}`);
    console.log(`  Fields collected: ${String(result['fieldsCount'])}`);

    const pi = result['personalInfo'] as Record<string, unknown> | undefined;
    if (pi) {
      console.log('\n  Personal Info:');
      console.log(`    Name: ${String(pi['firstName'])} ${String(pi['lastName'])}`);
      console.log(`    Email: ${String(pi['email'])}`);
    }

    const ai = result['addressInfo'] as Record<string, unknown> | undefined;
    if (ai) {
      console.log('\n  Address:');
      console.log(`    ${String(ai['street'])}, ${String(ai['city'])}, ${String(ai['country'])}`);
    }

    const pref = result['preferences'] as Record<string, unknown> | undefined;
    if (pref) {
      console.log('\n  Preferences:');
      console.log(`    Newsletter: ${String(pref['newsletter'])}`);
      console.log(`    Notifications: ${String(pref['notifications'])}`);
    }
  } else {
    console.log(`Final status: ${execution.status}`);
  }
}

async function runDocumentReview(polos: Polos): Promise<void> {
  printHeader('Document Review Workflow Demo');

  console.log('\nEnter document details:');
  const documentId = await ask('  Document ID', 'DOC-001');
  const documentTitle = await ask('  Document title', 'Q4 Report');
  const reviewersInput = await ask('  Reviewers (comma-separated)', 'alice,bob');
  const reviewers = reviewersInput.split(',').map((r) => r.trim());

  printSection('Starting workflow');
  console.log(`Starting document review for: ${documentTitle}`);
  console.log(`Reviewers: ${reviewers.join(', ')}`);

  const handle = await polos.invoke(documentReview.id, {
    documentId,
    documentTitle,
    reviewers,
  });
  console.log(`Execution ID: ${handle.id}`);

  for (let i = 0; i < reviewers.length; i++) {
    const reviewer = reviewers[i]!;
    const suspendStepKey = `review_${String(i)}_${reviewer}`;

    console.log(`\nWaiting for reviewer: ${reviewer}`);

    const suspendData = await waitForSuspend(polos, handle);
    if (suspendData) {
      console.log(`\n  Reviewer ${String(suspendData['reviewer_number'])} of ${String(suspendData['total_reviewers'])}`);
      console.log(`  Document: ${String(suspendData['document_title'])}`);
      console.log(`  ${String(suspendData['prompt'])}`);
    }

    console.log(`\n[Acting as ${reviewer}]`);
    const approved = await askYesNo(`  Does ${reviewer} approve?`);
    const comments = await ask('  Comments (optional)');
    const rating = Number(await ask('  Rating (1-5)', '4'));

    console.log(`\nSubmitting ${reviewer}'s review...`);
    await polos.resume(handle.rootWorkflowId, handle.id, suspendStepKey, {
      approved,
      comments: comments || undefined,
      rating,
    });
    console.log('Resume event published!');
  }

  await new Promise((r) => setTimeout(r, 2000));
  const execution = await polos.getExecution(handle.id);

  if (execution.status === 'completed') {
    printSection('Review Completed');
    const result = execution.result as Record<string, unknown>;
    console.log(`  Document: ${String(result['documentTitle'])}`);
    console.log(`  Status: ${String(result['status'])}`);
    console.log(`  All Approved: ${String(result['allApproved'])}`);

    console.log('\n  Reviews:');
    const reviews = result['reviews'] as { reviewer: string; feedback: { approved: boolean; rating?: number; comments?: string } }[];
    for (const review of reviews) {
      const icon = review.feedback.approved ? '[OK]' : '[X]';
      console.log(`    ${icon} ${review.reviewer}: rating=${String(review.feedback.rating)}`);
      if (review.feedback.comments) {
        console.log(`        Comments: ${review.feedback.comments}`);
      }
    }
  } else {
    console.log(`Final status: ${execution.status}`);
  }
}

async function main(): Promise<void> {
  const polos = new Polos({ deploymentId: 'suspend-resume-examples', logFile: 'polos.log' });
  await polos.start();

  try {
    printHeader('Suspend/Resume Workflow Demo');
    console.log('\nThis demo shows how workflows can pause for user input and resume.');

    let running = true;
    while (running) {
      const choice = await askChoice('Select a workflow to run:', [
        'Approval Workflow - Single approval with suspend/resume',
        'Multi-Step Form - Collect data across 3 steps',
        'Document Review - Multiple reviewers in sequence',
        'Exit',
      ]);

      try {
        if (choice === 1) {
          await runApprovalWorkflow(polos);
        } else if (choice === 2) {
          await runMultiStepForm(polos);
        } else if (choice === 3) {
          await runDocumentReview(polos);
        } else {
          console.log('\nGoodbye!');
          running = false;
        }
      } catch (e) {
        console.log(`\nError: ${String(e)}`);
        console.log('Please try again.');
      }

      if (running) {
        console.log('\n' + '-'.repeat(60));
      }
    }

    rl.close();
  } finally {
    await polos.stop();
  }
}

main().catch(console.error);
