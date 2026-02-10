/**
 * Tools for the conversational chat agent.
 */

import { defineTool, type WorkflowContext } from '@polos/sdk';
import { z } from 'zod';

// ── get_current_time ─────────────────────────────────────────────────

const timeInputSchema = z.object({
  timezone: z.string().default('UTC'),
});

const timeOutputSchema = z.object({
  time: z.string(),
  timezone: z.string(),
});

type TimeInput = z.infer<typeof timeInputSchema>;
type TimeOutput = z.infer<typeof timeOutputSchema>;

export const getCurrentTime = defineTool(
  {
    id: 'get_current_time',
    description: 'Get the current time',
    inputSchema: timeInputSchema,
    outputSchema: timeOutputSchema,
  },
  async (_ctx: WorkflowContext, input: TimeInput): Promise<TimeOutput> => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    const m = String(minutes).padStart(2, '0');

    return {
      time: `${String(h)}:${m} ${ampm}`,
      timezone: input.timezone,
    };
  },
);

// ── get_weather ──────────────────────────────────────────────────────

const weatherInputSchema = z.object({
  city: z.string(),
});

const weatherOutputSchema = z.object({
  city: z.string(),
  temperature: z.number(),
  condition: z.string(),
  unit: z.string(),
});

type WeatherInput = z.infer<typeof weatherInputSchema>;
type WeatherOutput = z.infer<typeof weatherOutputSchema>;

const WEATHER_DATA: Record<string, { temperature: number; condition: string; unit: string }> = {
  'new york': { temperature: 72, condition: 'Partly Cloudy', unit: 'F' },
  'san francisco': { temperature: 68, condition: 'Foggy', unit: 'F' },
  london: { temperature: 15, condition: 'Rainy', unit: 'C' },
  tokyo: { temperature: 22, condition: 'Sunny', unit: 'C' },
  paris: { temperature: 18, condition: 'Cloudy', unit: 'C' },
};

export const getWeather = defineTool(
  {
    id: 'get_weather',
    description: 'Get current weather for a city',
    inputSchema: weatherInputSchema,
    outputSchema: weatherOutputSchema,
  },
  async (_ctx: WorkflowContext, input: WeatherInput): Promise<WeatherOutput> => {
    const cityLower = input.city.toLowerCase();
    const weather = WEATHER_DATA[cityLower] ?? { temperature: 20, condition: 'Unknown', unit: 'C' };

    return {
      city: input.city,
      temperature: weather.temperature,
      condition: weather.condition,
      unit: weather.unit,
    };
  },
);

// ── calculator ───────────────────────────────────────────────────────

const calculatorInputSchema = z.object({
  expression: z.string(),
});

const calculatorOutputSchema = z.object({
  expression: z.string(),
  result: z.number(),
  error: z.string().nullable().optional(),
});

type CalculatorInput = z.infer<typeof calculatorInputSchema>;
type CalculatorOutput = z.infer<typeof calculatorOutputSchema>;

export const calculator = defineTool(
  {
    id: 'calculator',
    description: 'Evaluate a mathematical expression',
    inputSchema: calculatorInputSchema,
    outputSchema: calculatorOutputSchema,
  },
  async (_ctx: WorkflowContext, input: CalculatorInput): Promise<CalculatorOutput> => {
    try {
      // Only allow safe math characters
      const allowed = /^[0-9+\-*/.() ]+$/;
      if (!allowed.test(input.expression)) {
        return {
          expression: input.expression,
          result: 0,
          error: 'Invalid characters in expression',
        };
      }

      // eslint-disable-next-line no-eval -- safe: validated to only contain math chars
      const result = eval(input.expression) as number;
      return {
        expression: input.expression,
        result: Number(result),
        error: null,
      };
    } catch (e) {
      return {
        expression: input.expression,
        result: 0,
        error: String(e),
      };
    }
  },
);
