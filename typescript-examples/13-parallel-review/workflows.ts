/**
 * Parallel review workflow examples.
 *
 * Demonstrates how to run multiple workflows in parallel and aggregate results.
 * Useful for scenarios like:
 * - Multi-reviewer document review
 * - Parallel data processing
 * - Fan-out/fan-in patterns
 */

import { defineWorkflow } from '@polos/sdk';
import type { BatchWorkflowInput, BatchStepResult } from '@polos/sdk';

// ============================================================================
// Payload / Result Types
// ============================================================================

export interface ReviewRequest {
  reviewerId: string;
  documentId: string;
  content: string;
}

export interface ReviewResult {
  reviewerId: string;
  documentId: string;
  approved: boolean;
  score: number; // 1-10
  comments: string;
}

interface AggregatedReview {
  documentId: string;
  totalReviews: number;
  approvedCount: number;
  averageScore: number;
  allApproved: boolean;
  reviews: { reviewerId: string; approved: boolean; score: number; comments: string }[];
}

interface ChunkProcessorPayload {
  data: unknown[];
  chunkSize: number;
}

interface ChunkProcessorResult {
  totalItems: number;
  chunksProcessed: number;
  processedItems: number;
  results: unknown[];
}

interface ChunkPayload {
  chunk: unknown[];
  chunkIndex: number;
}

interface ChunkResult {
  chunkIndex: number;
  processed: unknown[];
}

interface FireAndForgetPayload {
  tasks: { id: string; data: Record<string, unknown> }[];
}

interface BackgroundTaskPayload {
  taskId: string;
  data: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

function analyzeDocument(documentId: string, content: string): Record<string, unknown> {
  return {
    documentId,
    wordCount: content.split(/\s+/).length,
    qualityScore: 8, // Simulated
  };
}

function generateReview(reviewerId: string, analysis: Record<string, unknown>): Record<string, unknown> {
  const score = (analysis['qualityScore'] as number) ?? 5;
  return {
    approved: score >= 6,
    score,
    comments: `Review by ${reviewerId}: Quality score ${String(score)}/10`,
  };
}

// ============================================================================
// Single Review Workflow
// ============================================================================

export const singleReview = defineWorkflow<ReviewRequest, unknown, ReviewResult>(
  { id: 'single_review' },
  async (ctx, payload) => {
    const result = await ctx.step.run(
      'analyze_document',
      () => analyzeDocument(payload.documentId, payload.content),
    );

    const review = await ctx.step.run(
      'generate_review',
      () => generateReview(payload.reviewerId, result),
    );

    return {
      reviewerId: payload.reviewerId,
      documentId: payload.documentId,
      approved: review['approved'] as boolean,
      score: review['score'] as number,
      comments: review['comments'] as string,
    };
  },
);

// ============================================================================
// Parallel Review Workflow
// ============================================================================

export const parallelReview = defineWorkflow<Record<string, unknown>, unknown, AggregatedReview>(
  { id: 'parallel_review' },
  async (ctx, payload) => {
    const documentId = (payload['documentId'] as string) ?? 'doc-1';
    const content = (payload['content'] as string) ?? 'Sample document content';
    const reviewers = (payload['reviewers'] as string[]) ?? ['alice', 'bob', 'charlie'];

    // Create batch of review requests
    const reviewRequests: BatchWorkflowInput[] = reviewers.map((reviewer) => ({
      workflow: 'single_review',
      payload: {
        reviewerId: reviewer,
        documentId,
        content,
      } satisfies ReviewRequest,
    }));

    // Run all reviews in parallel and wait for all to complete
    const results = await ctx.step.batchInvokeAndWait<ReviewResult>(
      'parallel_reviews',
      reviewRequests,
    );

    // Aggregate results (each entry is a BatchStepResult wrapper)
    const reviews: AggregatedReview['reviews'] = [];
    let approvedCount = 0;
    let totalScore = 0;

    for (const entry of results) {
      const review = entry.result;
      if (!review) continue;
      reviews.push({
        reviewerId: review.reviewerId,
        approved: review.approved,
        score: review.score,
        comments: review.comments,
      });
      if (review.approved) {
        approvedCount += 1;
      }
      totalScore += review.score;
    }

    const totalReviews = reviews.length;
    const averageScore = totalReviews > 0 ? totalScore / totalReviews : 0;
    const allApproved = approvedCount === totalReviews;

    return {
      documentId,
      totalReviews,
      approvedCount,
      averageScore,
      allApproved,
      reviews,
    };
  },
);

// ============================================================================
// Data Chunk Processor (fan-out/fan-in)
// ============================================================================

export const dataChunkProcessor = defineWorkflow<ChunkProcessorPayload, unknown, ChunkProcessorResult>(
  { id: 'data_chunk_processor' },
  async (ctx, payload) => {
    const data = payload.data;
    const chunkSize = payload.chunkSize;

    // Split data into chunks
    const chunks: unknown[][] = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }

    // Create batch of chunk processing requests
    const chunkRequests: BatchWorkflowInput[] = chunks.map((chunk, i) => ({
      workflow: 'process_chunk',
      payload: { chunk, chunkIndex: i } satisfies ChunkPayload,
    }));

    // Process all chunks in parallel
    const results = await ctx.step.batchInvokeAndWait<ChunkResult>(
      'parallel_chunks',
      chunkRequests,
    );

    // Aggregate results (each entry is a BatchStepResult wrapper)
    const allProcessed: unknown[] = [];
    for (const entry of results) {
      if (entry.result) {
        allProcessed.push(...entry.result.processed);
      }
    }

    return {
      totalItems: data.length,
      chunksProcessed: results.length,
      processedItems: allProcessed.length,
      results: allProcessed,
    };
  },
);

// ============================================================================
// Process Chunk (invoked by data_chunk_processor)
// ============================================================================

export const processChunk = defineWorkflow<ChunkPayload, unknown, ChunkResult>(
  { id: 'process_chunk' },
  async (ctx, payload) => {
    const chunk = payload.chunk;
    const chunkIndex = payload.chunkIndex;

    const processed = await ctx.step.run(
      `process_items_${String(chunkIndex)}`,
      () =>
        chunk.map((item) =>
          typeof item === 'string' ? item.toUpperCase() : (item as number) * 2,
        ),
    );

    return { chunkIndex, processed };
  },
);

// ============================================================================
// Fire and Forget Batch
// ============================================================================

export const fireAndForgetBatch = defineWorkflow<FireAndForgetPayload, unknown, Record<string, unknown>>(
  { id: 'fire_and_forget_batch' },
  async (ctx, payload) => {
    const tasks = payload.tasks;

    // Create batch of task requests
    const taskRequests: BatchWorkflowInput[] = tasks.map((task) => ({
      workflow: 'background_task',
      payload: { taskId: task.id, data: task.data } satisfies BackgroundTaskPayload,
    }));

    // Launch all tasks in parallel (non-blocking)
    const handles = await ctx.step.batchInvoke(
      'launch_background_tasks',
      taskRequests,
    );

    return {
      launched: handles.length,
      executionIds: handles.map((h) => h.executionId),
    };
  },
);

// ============================================================================
// Background Task (invoked by fire_and_forget_batch)
// ============================================================================

export const backgroundTask = defineWorkflow<BackgroundTaskPayload, unknown, Record<string, unknown>>(
  { id: 'background_task' },
  async (ctx, payload) => {
    const result = await ctx.step.run(
      'execute_task',
      () => ({ taskId: payload.taskId, status: 'completed' }),
    );

    return result;
  },
);
