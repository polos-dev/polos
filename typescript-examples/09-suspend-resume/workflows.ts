/**
 * Suspend and resume workflow examples.
 */

import { defineWorkflow } from '@polos/sdk';
import type { WorkflowContext } from '@polos/sdk';

// ============================================================================
// Approval Workflow
// ============================================================================

interface ApprovalRequest {
  requestId: string;
  requester: string;
  description: string;
  amount: number;
}

interface ApprovalDecision {
  approved: boolean;
  approver: string;
  comments?: string;
}

interface ApprovalResult {
  requestId: string;
  status: string;
  approved?: boolean;
  approver?: string;
  comments?: string;
}

export const approvalWorkflow = defineWorkflow<ApprovalRequest, unknown, ApprovalResult>(
  { id: 'approval_workflow' },
  async (ctx, payload) => {
    // Step 1: Validate and prepare request
    await ctx.step.run('prepare_request', () => ({
      prepared: true,
      requestId: payload.requestId,
    }));

    // Step 2: Suspend and wait for approval
    const resumeData = await ctx.step.suspend<Record<string, unknown>, Record<string, unknown>>(
      'await_approval',
      {
        data: {
          request_id: payload.requestId,
          requester: payload.requester,
          description: payload.description,
          amount: payload.amount,
          message: 'Please review and approve/reject this request',
        },
        timeout: 86400, // 24 hour timeout
      },
    );

    // Step 3: Process the decision
    const decisionData = (resumeData?.['data'] ?? resumeData) as Record<string, unknown>;
    const decision: ApprovalDecision = {
      approved: Boolean(decisionData['approved']),
      approver: String(decisionData['approver'] ?? ''),
      comments: decisionData['comments'] != null ? String(decisionData['comments']) : undefined,
    };

    if (decision.approved) {
      await ctx.step.run('process_approval', () => ({
        action: 'approved',
        requestId: payload.requestId,
      }));
    } else {
      await ctx.step.run('process_rejection', () => ({
        action: 'rejected',
        requestId: payload.requestId,
      }));
    }

    return {
      requestId: payload.requestId,
      status: decision.approved ? 'approved' : 'rejected',
      approved: decision.approved,
      approver: decision.approver,
      comments: decision.comments,
    };
  },
);

// ============================================================================
// Multi-Step Form Workflow
// ============================================================================

interface MultiStepFormPayload {
  formId: string;
  formType?: string;
}

interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
}

interface AddressInfo {
  street: string;
  city: string;
  country: string;
}

interface Preferences {
  newsletter: boolean;
  notifications: boolean;
}

interface MultiStepFormResult {
  formId: string;
  status: string;
  personalInfo?: PersonalInfo;
  addressInfo?: AddressInfo;
  preferences?: Preferences;
  fieldsCount: number;
}

export const multiStepForm = defineWorkflow<MultiStepFormPayload, unknown, MultiStepFormResult>(
  { id: 'multi_step_form' },
  async (ctx, payload) => {
    // Step 1: Collect personal information
    const step1Data = await ctx.step.suspend<Record<string, unknown>, Record<string, unknown>>(
      'personal_info',
      {
        data: {
          form_id: payload.formId,
          step: 1,
          total_steps: 3,
          prompt: 'Please provide your personal information',
          fields: ['first_name', 'last_name', 'email'],
        },
      },
    );
    const step1 = (step1Data?.['data'] ?? step1Data) as Record<string, unknown>;
    const personalInfo: PersonalInfo = {
      firstName: String(step1['first_name'] ?? ''),
      lastName: String(step1['last_name'] ?? ''),
      email: String(step1['email'] ?? ''),
    };

    // Step 2: Collect address information
    const step2Data = await ctx.step.suspend<Record<string, unknown>, Record<string, unknown>>(
      'address_info',
      {
        data: {
          form_id: payload.formId,
          step: 2,
          total_steps: 3,
          prompt: 'Please provide your address',
          fields: ['street', 'city', 'country'],
        },
      },
    );
    const step2 = (step2Data?.['data'] ?? step2Data) as Record<string, unknown>;
    const addressInfo: AddressInfo = {
      street: String(step2['street'] ?? ''),
      city: String(step2['city'] ?? ''),
      country: String(step2['country'] ?? ''),
    };

    // Step 3: Collect preferences
    const step3Data = await ctx.step.suspend<Record<string, unknown>, Record<string, unknown>>(
      'preferences',
      {
        data: {
          form_id: payload.formId,
          step: 3,
          total_steps: 3,
          prompt: 'Please select your preferences',
          fields: ['newsletter', 'notifications'],
        },
      },
    );
    const step3 = (step3Data?.['data'] ?? step3Data) as Record<string, unknown>;
    const preferences: Preferences = {
      newsletter: Boolean(step3['newsletter']),
      notifications: step3['notifications'] !== false,
    };

    const fieldsCount = 3 + 3 + 2; // personal + address + preferences

    return {
      formId: payload.formId,
      status: 'completed',
      personalInfo,
      addressInfo,
      preferences,
      fieldsCount,
    };
  },
);

// ============================================================================
// Document Review Workflow
// ============================================================================

interface ReviewFeedback {
  approved: boolean;
  comments?: string;
  rating?: number;
}

interface ReviewerResult {
  reviewer: string;
  feedback: ReviewFeedback;
}

interface DocumentReviewPayload {
  documentId: string;
  documentTitle: string;
  reviewers: string[];
}

interface DocumentReviewResult {
  documentId: string;
  documentTitle: string;
  reviews: ReviewerResult[];
  allApproved: boolean;
  status: string;
}

export const documentReview = defineWorkflow<DocumentReviewPayload, unknown, DocumentReviewResult>(
  { id: 'document_review' },
  async (ctx, payload) => {
    const reviews: ReviewerResult[] = [];

    for (let i = 0; i < payload.reviewers.length; i++) {
      const reviewer = payload.reviewers[i]!;

      // Suspend for each reviewer
      const reviewData = await ctx.step.suspend<Record<string, unknown>, Record<string, unknown>>(
        `review_${String(i)}_${reviewer}`,
        {
          data: {
            document_id: payload.documentId,
            document_title: payload.documentTitle,
            reviewer,
            reviewer_number: i + 1,
            total_reviewers: payload.reviewers.length,
            prompt: `Please review document: ${payload.documentTitle}`,
            fields: ['approved', 'comments', 'rating'],
          },
          timeout: 172800, // 48 hour timeout per reviewer
        },
      );

      const data = (reviewData?.['data'] ?? reviewData) as Record<string, unknown>;
      const feedback: ReviewFeedback = {
        approved: Boolean(data['approved']),
        comments: data['comments'] != null ? String(data['comments']) : undefined,
        rating: data['rating'] != null ? Number(data['rating']) : undefined,
      };
      reviews.push({ reviewer, feedback });
    }

    const allApproved = reviews.every((r) => r.feedback.approved);

    return {
      documentId: payload.documentId,
      documentTitle: payload.documentTitle,
      reviews,
      allApproved,
      status: allApproved ? 'approved' : 'needs_revision',
    };
  },
);
