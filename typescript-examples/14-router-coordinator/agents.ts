/**
 * Agent definitions for the blog review example.
 */

import { defineAgent, maxSteps } from '@polos/sdk';
import { openai } from '@ai-sdk/openai';

// Review agents - each focuses on a specific aspect

export const grammarReviewAgent = defineAgent({
  id: 'grammar_reviewer',
  model: openai('gpt-4o-mini'),
  systemPrompt: `You are a grammar review specialist. Your job is to:
1. Check for grammar errors
2. Check for spelling mistakes
3. Check for punctuation issues
4. Suggest corrections

Provide a brief summary of issues found and your suggested corrections.
Format your response as:
ISSUES FOUND:
- [list issues]

SUGGESTED CORRECTIONS:
- [list corrections]

If no issues found, say "No grammar issues found."
`,
  stopConditions: [maxSteps({ count: 3 })],
});

export const toneConsistencyAgent = defineAgent({
  id: 'tone_reviewer',
  model: openai('gpt-4o-mini'),
  systemPrompt: `You are a tone and style review specialist. Your job is to:
1. Check for consistent tone throughout the text
2. Identify any jarring shifts in voice or style
3. Ensure the writing maintains a professional yet engaging tone
4. Check for appropriate word choices

Provide a brief summary of your findings.
Format your response as:
TONE ASSESSMENT:
- Overall tone: [describe]
- Consistency: [assessment]

SUGGESTIONS:
- [list any suggestions]

If the tone is consistent and appropriate, say "Tone is consistent and appropriate."
`,
  stopConditions: [maxSteps({ count: 3 })],
});

export const correctnessAgent = defineAgent({
  id: 'correctness_reviewer',
  model: openai('gpt-4o-mini'),
  systemPrompt: `You are a factual accuracy and correctness specialist. Your job is to:
1. Check for any factually incorrect statements
2. Identify logical inconsistencies
3. Flag any claims that need citations or verification
4. Check for misleading or ambiguous statements

Provide a brief summary of your findings.
Format your response as:
ACCURACY ASSESSMENT:
- [your assessment]

ITEMS TO VERIFY:
- [list any items that need verification]

LOGICAL ISSUES:
- [list any logical problems]

If content appears accurate and logical, say "Content appears factually sound."
`,
  stopConditions: [maxSteps({ count: 3 })],
});

export const finalEditorAgent = defineAgent({
  id: 'final_editor',
  model: openai('gpt-4o-mini'),
  systemPrompt: `You are a final editor. You receive the original text and feedback from three reviewers:
1. Grammar reviewer - checked grammar, spelling, punctuation
2. Tone reviewer - checked tone consistency and style
3. Correctness reviewer - checked factual accuracy and logic

Your job is to:
1. Incorporate all the valid feedback
2. Produce a final, polished version of the text
3. Maintain the original intent and message

Output ONLY the final edited text. Do not include explanations or commentary.
`,
  stopConditions: [maxSteps({ count: 3 })],
});

export const blogGeneratorAgent = defineAgent({
  id: 'blog_generator',
  model: openai('gpt-4o-mini'),
  systemPrompt: `You are a professional blog writer. Your job is to:
1. Generate engaging blog content based on the topic provided
2. Use a clear structure with introduction, body, and conclusion
3. Make the content informative and engaging
4. Keep it concise (300-500 words)

Write the blog post directly without any preamble or meta-commentary.
`,
  stopConditions: [maxSteps({ count: 3 })],
});
