/**
 * Zod schemas for structured output.
 */

import { z } from 'zod';

/** Structured output schema for movie reviews. */
export const movieReviewSchema = z.object({
  title: z.string().describe('The title of the movie'),
  rating: z.number().int().min(1).max(10).describe('Rating from 1-10'),
  genre: z.string().describe("The movie's genre(s)"),
  summary: z.string().describe('A brief summary of the movie'),
  pros: z.array(z.string()).describe('List of positive aspects'),
  cons: z.array(z.string()).describe('List of negative aspects'),
  recommendation: z.string().describe('Who should watch this movie'),
});

export type MovieReview = z.infer<typeof movieReviewSchema>;

/** Structured output schema for recipes. */
export const recipeOutputSchema = z.object({
  name: z.string().describe('Name of the recipe'),
  prep_time_minutes: z.number().int().describe('Preparation time in minutes'),
  cook_time_minutes: z.number().int().describe('Cooking time in minutes'),
  servings: z.number().int().describe('Number of servings'),
  difficulty: z.string().describe('Difficulty level: Easy, Medium, or Hard'),
  ingredients: z.array(z.string()).describe('List of ingredients with quantities'),
  instructions: z.array(z.string()).describe('Step-by-step cooking instructions'),
  tips: z.array(z.string()).default([]).describe('Optional cooking tips'),
});

export type RecipeOutput = z.infer<typeof recipeOutputSchema>;

/** Structured output schema for sentiment analysis. */
export const sentimentAnalysisSchema = z.object({
  text: z.string().describe('The analyzed text'),
  sentiment: z.string().describe('Overall sentiment: positive, negative, or neutral'),
  confidence: z.number().min(0).max(1).describe('Confidence score 0-1'),
  emotions: z.array(z.string()).describe('Detected emotions'),
  key_phrases: z.array(z.string()).describe('Key phrases that influenced the analysis'),
});

export type SentimentAnalysis = z.infer<typeof sentimentAnalysisSchema>;
