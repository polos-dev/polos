/**
 * Example tools for agents.
 */

import { defineTool, type WorkflowContext } from '@polos/sdk';
import { z } from 'zod';

// Pre-canned weather data for various cities
const WEATHER_DATA: Record<string, WeatherOutput> = {
  'new york': {
    city: 'New York',
    temperature: 72,
    condition: 'Partly Cloudy',
    humidity: 65,
    wind_speed: 10,
    unit: 'F',
  },
  'san francisco': {
    city: 'San Francisco',
    temperature: 68,
    condition: 'Foggy',
    humidity: 80,
    wind_speed: 8,
    unit: 'F',
  },
  london: {
    city: 'London',
    temperature: 15,
    condition: 'Rainy',
    humidity: 85,
    wind_speed: 12,
    unit: 'C',
  },
  tokyo: {
    city: 'Tokyo',
    temperature: 22,
    condition: 'Sunny',
    humidity: 60,
    wind_speed: 5,
    unit: 'C',
  },
  paris: {
    city: 'Paris',
    temperature: 18,
    condition: 'Cloudy',
    humidity: 70,
    wind_speed: 9,
    unit: 'C',
  },
};

const weatherInputSchema = z.object({
  city: z.string(),
});

const weatherOutputSchema = z.object({
  city: z.string(),
  temperature: z.number(),
  condition: z.string(),
  humidity: z.number(),
  wind_speed: z.number(),
  unit: z.string(),
  error: z.string().nullable().optional(),
});

type WeatherInput = z.infer<typeof weatherInputSchema>;
type WeatherOutput = z.infer<typeof weatherOutputSchema>;

/**
 * Tool that returns weather information for a city.
 *
 * This is a simple example tool that the agent can call.
 * In a real scenario, this would query a weather API.
 */
export const getWeather = defineTool(
  {
    id: 'get_weather',
    description: 'Get the current weather information for a given city',
    inputSchema: weatherInputSchema,
    outputSchema: weatherOutputSchema,
  },
  async (_ctx: WorkflowContext, input: WeatherInput): Promise<WeatherOutput> => {
    const city = input.city.trim().toLowerCase();
    let weather = WEATHER_DATA[city];

    if (!weather) {
      // Try to find a partial match
      for (const [key, value] of Object.entries(WEATHER_DATA)) {
        if (city.includes(key) || key.includes(city)) {
          weather = value;
          break;
        }
      }
    }

    if (!weather) {
      // Fallback to a default value
      weather = WEATHER_DATA['new york'];
    }

    return { ...weather, error: null };
  },
);
