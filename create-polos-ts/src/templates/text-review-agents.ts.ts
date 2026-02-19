import type { ProviderConfig } from '../providers.js';

export function textReviewAgentsTemplate(provider: ProviderConfig): string {
  return `${provider.import};
import { defineAgent, maxSteps } from '@polos/sdk';

export const grammarReviewAgent = defineAgent({
  id: 'grammar_reviewer',
  model: ${provider.call},
  systemPrompt: \`You are a grammar reviewer. Analyze the provided text for grammatical errors,
punctuation issues, and sentence structure problems. Provide a concise review with specific
suggestions for improvement. Return your review as a single string.\`,
  stopConditions: [maxSteps({ count: 10 })],
});

export const toneConsistencyAgent = defineAgent({
  id: 'tone_reviewer',
  model: ${provider.call},
  systemPrompt: \`You are a tone and consistency reviewer. Analyze the provided text for tone shifts,
inconsistencies in voice, and style issues. Provide a concise review with specific suggestions
for improvement. Return your review as a single string.\`,
  stopConditions: [maxSteps({ count: 10 })],
});

export const correctnessAgent = defineAgent({
  id: 'correctness_reviewer',
  model: ${provider.call},
  systemPrompt: \`You are a factual correctness reviewer. Analyze the provided text for factual accuracy,
logical consistency, and unsupported claims. Provide a concise review with specific concerns.
Return your review as a single string.\`,
  stopConditions: [maxSteps({ count: 10 })],
});

export const finalEditorAgent = defineAgent({
  id: 'final_editor',
  model: ${provider.call},
  systemPrompt: \`You are a final editor. You will receive the original text along with reviews from
grammar, tone, and correctness reviewers. Synthesize all feedback and produce an improved
version of the text. Return only the improved text.\`,
  stopConditions: [maxSteps({ count: 10 })],
});
`;
}
