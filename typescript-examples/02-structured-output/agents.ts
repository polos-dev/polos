/**
 * Agents with structured output using Zod schemas.
 */

import { defineAgent, maxSteps } from '@polos/sdk';
import { openai } from '@ai-sdk/openai';
import { movieReviewSchema, recipeOutputSchema, sentimentAnalysisSchema } from './schemas.js';

// Movie reviewer agent with structured output
export const movieReviewer = defineAgent({
  id: 'movie_reviewer',
  model: openai('gpt-4o-mini'),
  systemPrompt: `You are a professional movie critic. When asked to review a movie,
provide a comprehensive review with rating, pros, cons, and recommendation.
Always respond with structured data matching the required format.`,
  outputSchema: movieReviewSchema,
  stopConditions: [maxSteps({ count: 5 })],
});

// Recipe generator agent with structured output
export const recipeGenerator = defineAgent({
  id: 'recipe_generator',
  model: openai('gpt-4o-mini'),
  systemPrompt: `You are a professional chef. When asked for a recipe,
provide detailed instructions including ingredients, prep time, and cooking tips.
Always respond with structured data matching the required format.`,
  outputSchema: recipeOutputSchema,
  stopConditions: [maxSteps({ count: 5 })],
});

// Sentiment analyzer agent with structured output
export const sentimentAnalyzer = defineAgent({
  id: 'sentiment_analyzer',
  model: openai('gpt-4o-mini'),
  systemPrompt: `You are a sentiment analysis expert. Analyze the given text
and provide sentiment, confidence score, detected emotions, and key phrases.
Always respond with structured data matching the required format.`,
  outputSchema: sentimentAnalysisSchema,
  stopConditions: [maxSteps({ count: 5 })],
});
