export function textReviewWorkflowTemplate(): string {
  return `import { defineWorkflow } from '@polos/sdk';
import {
  grammarReviewAgent,
  toneConsistencyAgent,
  correctnessAgent,
  finalEditorAgent,
} from './agents.js';

interface TextReviewPayload {
  text: string;
}

interface TextReviewResult {
  originalText: string;
  grammarReview: string;
  toneReview: string;
  correctnessReview: string;
  finalText: string;
}

export const textReview = defineWorkflow<TextReviewPayload, unknown, TextReviewResult>(
  { id: 'text_review' },
  async (ctx, payload) => {
    const { text } = payload;

    // Run 3 reviewers in parallel
    const reviewResults = await ctx.step.batchAgentInvokeAndWait<Record<string, unknown>>(
      'parallel_reviews',
      [
        grammarReviewAgent.withInput(\`Review this text for grammar:\\n\\n\${text}\`),
        toneConsistencyAgent.withInput(\`Review this text for tone:\\n\\n\${text}\`),
        correctnessAgent.withInput(\`Review this text for correctness:\\n\\n\${text}\`),
      ],
    );

    const grammarReview = (reviewResults[0]?.['result'] as string) ?? '';
    const toneReview = (reviewResults[1]?.['result'] as string) ?? '';
    const correctnessReview = (reviewResults[2]?.['result'] as string) ?? '';

    // Send all reviews to the final editor
    const editorPrompt = \`Original text:
\${text}

Grammar review:
\${grammarReview}

Tone review:
\${toneReview}

Correctness review:
\${correctnessReview}

Please produce an improved version of the original text incorporating the feedback above.\`;

    const editorResult = (await ctx.step.agentInvokeAndWait(
      'final_editor',
      finalEditorAgent.withInput(editorPrompt),
    )) as Record<string, unknown>;

    return {
      originalText: text,
      grammarReview,
      toneReview,
      correctnessReview,
      finalText: (editorResult['result'] as string) ?? '',
    };
  },
);
`;
}
