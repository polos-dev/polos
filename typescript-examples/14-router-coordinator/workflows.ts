/**
 * Workflow definitions for the blog review example.
 *
 * Demonstrates:
 * 1. Calling multiple agents in parallel
 * 2. Aggregating agent outputs
 * 3. Chaining workflows with agent calls
 */

import { defineWorkflow } from '@polos/sdk';
import {
  grammarReviewAgent,
  toneConsistencyAgent,
  correctnessAgent,
  finalEditorAgent,
  blogGeneratorAgent,
} from './agents.js';

// ============================================================================
// Payload / Result Types
// ============================================================================

export interface BlogReviewPayload {
  text: string;
}

export interface BlogReviewResult {
  originalText: string;
  grammarReview: string;
  toneReview: string;
  correctnessReview: string;
  finalText: string;
}

export interface GenerateBlogPayload {
  topic: string;
  additionalInstructions?: string;
}

export interface GenerateBlogResult {
  topic: string;
  draftBlog: string;
  grammarReview: string;
  toneReview: string;
  correctnessReview: string;
  finalBlog: string;
}

// ============================================================================
// Blog Review Workflow
// ============================================================================

export const blogReview = defineWorkflow<BlogReviewPayload, unknown, BlogReviewResult>(
  { id: 'blog_review' },
  async (ctx, payload) => {
    const text = payload.text;

    // Run all reviews in parallel
    const reviewResults = await ctx.step.batchAgentInvokeAndWait<Record<string, unknown>>(
      'parallel_reviews',
      [
        grammarReviewAgent.withInput(
          `Please review the following text for grammar, spelling, and punctuation:\n\n${text}`,
        ),
        toneConsistencyAgent.withInput(
          `Please review the following text for tone consistency and style:\n\n${text}`,
        ),
        correctnessAgent.withInput(
          `Please review the following text for factual accuracy and logical consistency:\n\n${text}`,
        ),
      ],
    );

    // Extract review results
    const grammarReview = (reviewResults[0]?.['result'] as string) ?? '';
    const toneReview = (reviewResults[1]?.['result'] as string) ?? '';
    const correctnessReview = (reviewResults[2]?.['result'] as string) ?? '';

    // Step 2: Call final editor with all feedback
    const editorPrompt = `Here is the original text:

${text}

Here is the feedback from our reviewers:

=== GRAMMAR REVIEW ===
${grammarReview}

=== TONE REVIEW ===
${toneReview}

=== CORRECTNESS REVIEW ===
${correctnessReview}

Please produce the final polished version of the text, incorporating all valid feedback.`;

    const editorResult = (await ctx.step.agentInvokeAndWait(
      'final_editor',
      finalEditorAgent.withInput(editorPrompt),
    )) as Record<string, unknown>;

    const finalText = (editorResult['result'] as string) ?? '';

    return {
      originalText: text,
      grammarReview,
      toneReview,
      correctnessReview,
      finalText,
    };
  },
);

// ============================================================================
// Generate Blog Workflow
// ============================================================================

export const generateBlog = defineWorkflow<GenerateBlogPayload, unknown, GenerateBlogResult>(
  { id: 'generate_blog' },
  async (ctx, payload) => {
    const topic = payload.topic;
    const instructions = payload.additionalInstructions ?? '';

    // Step 1: Generate the initial blog draft
    let generatorPrompt = `Write a blog post about: ${topic}`;
    if (instructions) {
      generatorPrompt += `\n\nAdditional instructions: ${instructions}`;
    }

    const generatorResult = (await ctx.step.agentInvokeAndWait(
      'blog_generator',
      blogGeneratorAgent.withInput(generatorPrompt),
    )) as Record<string, unknown>;

    const draftBlog = (generatorResult['result'] as string) ?? '';

    // Step 2: Send draft through blog review workflow
    const reviewResult = await ctx.step.invokeAndWait(
      'review_blog',
      blogReview,
      { text: draftBlog },
    );

    return {
      topic,
      draftBlog,
      grammarReview: reviewResult.grammarReview,
      toneReview: reviewResult.toneReview,
      correctnessReview: reviewResult.correctnessReview,
      finalBlog: reviewResult.finalText,
    };
  },
);
