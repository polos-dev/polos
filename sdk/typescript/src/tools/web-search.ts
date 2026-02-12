/**
 * Web search tool — lets agents search the web for current information.
 *
 * Defaults to the Tavily Search API using raw fetch() (no additional
 * dependencies). Users can plug in any search provider via a custom
 * function.
 *
 * @example
 * ```typescript
 * import { createWebSearchTool } from '@polos/sdk';
 *
 * // Tavily with env var (TAVILY_API_KEY)
 * const webSearch = createWebSearchTool();
 *
 * // Custom provider
 * const webSearch = createWebSearchTool({
 *   search: async (query, opts) => {
 *     const res = await mySearchApi(query, opts.maxResults);
 *     return { query, results: res.items };
 *   },
 * });
 * ```
 */

import { z } from 'zod';
import { defineTool } from '../core/tool.js';
import type { ToolWorkflow } from '../core/tool.js';

// ── Result types (provider-agnostic) ─────────────────────────────────

/** A single search result item. */
export interface WebSearchResultItem {
  title: string;
  url: string;
  /** Snippet or summary of the page content. */
  content: string;
  /** Relevance score, 0–1. */
  score?: number | undefined;
  /** Publication date in ISO 8601 format. */
  publishedDate?: string | undefined;
}

/** Full search result returned by the tool. */
export interface WebSearchResult {
  query: string;
  results: WebSearchResultItem[];
  /** AI-generated summary (Tavily feature). */
  answer?: string | undefined;
}

// ── Options passed to the search function ────────────────────────────

/** Options forwarded to the search function at call time. */
export interface WebSearchOptions {
  maxResults: number;
  topic: 'general' | 'news';
}

// ── Custom provider interface ────────────────────────────────────────

/** Signature for a custom search provider function. */
export type WebSearchFunction = (
  query: string,
  options: WebSearchOptions
) => Promise<WebSearchResult>;

// ── Configuration ────────────────────────────────────────────────────

/** Tavily-specific configuration knobs. */
export interface TavilySearchConfig {
  /** Tavily API key. Falls back to the TAVILY_API_KEY environment variable. */
  apiKey?: string;
  /** Search depth. @default 'basic' */
  searchDepth?: 'basic' | 'advanced';
  /** Include an AI-generated answer in the response. @default true */
  includeAnswer?: boolean;
  /** Include raw page content in results. @default false */
  includeRawContent?: boolean;
  /** Tavily API base URL. @default 'https://api.tavily.com' */
  baseUrl?: string;
}

/** Configuration for createWebSearchTool(). */
export interface WebSearchToolConfig extends TavilySearchConfig {
  /** Custom search provider. When set, overrides the built-in Tavily implementation. */
  search?: WebSearchFunction;
  /** Default maximum results per query. @default 5 */
  maxResults?: number;
  /** Default topic filter. @default 'general' */
  topic?: 'general' | 'news';
  /** Tool identifier exposed to the LLM. @default 'web_search' */
  toolId?: string;
}

// ── LLM-facing input schema ──────────────────────────────────────────

const webSearchInputSchema = z.object({
  query: z.string().describe('The search query'),
  maxResults: z.number().optional().describe('Maximum number of results to return'),
  topic: z
    .enum(['general', 'news'])
    .optional()
    .describe('Topic filter: general web search or news'),
});

type WebSearchInput = z.infer<typeof webSearchInputSchema>;

// ── Tavily implementation (internal) ─────────────────────────────────

interface TavilyResponse {
  query: string;
  answer?: string;
  results: {
    title: string;
    url: string;
    content: string;
    score?: number;
    published_date?: string;
    raw_content?: string;
  }[];
}

function createTavilySearchFn(config: TavilySearchConfig): WebSearchFunction {
  return async (query: string, options: WebSearchOptions): Promise<WebSearchResult> => {
    const apiKey = config.apiKey ?? process.env['TAVILY_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'Tavily API key is required. Provide it via the apiKey option or set the TAVILY_API_KEY environment variable.'
      );
    }

    const baseUrl = (config.baseUrl ?? 'https://api.tavily.com').replace(/\/+$/, '');

    const body = {
      query,
      max_results: options.maxResults,
      search_depth: config.searchDepth ?? 'basic',
      include_answer: config.includeAnswer ?? true,
      include_raw_content: config.includeRawContent ?? false,
      topic: options.topic,
    };

    const response = await fetch(`${baseUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        errorMessage =
          typeof errorBody['detail'] === 'string' ? errorBody['detail'] : JSON.stringify(errorBody);
      } catch {
        errorMessage = await response.text();
      }
      throw new Error(`Tavily API error (${String(response.status)}): ${errorMessage}`);
    }

    const data = (await response.json()) as TavilyResponse;

    return {
      query: data.query,
      answer: data.answer,
      results: data.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
        publishedDate: r.published_date,
      })),
    };
  };
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create a web search tool for agent use.
 *
 * By default uses the Tavily Search API via raw fetch(). Pass a custom
 * `search` function to use any other provider.
 *
 * @example
 * ```typescript
 * // Tavily with env var
 * const webSearch = createWebSearchTool();
 *
 * // Tavily with explicit key
 * const webSearch = createWebSearchTool({ apiKey: 'tvly-xxx' });
 *
 * // Custom provider
 * const webSearch = createWebSearchTool({
 *   search: async (query, opts) => {
 *     const res = await myApi(query, opts.maxResults);
 *     return { query, results: res.items };
 *   },
 * });
 * ```
 */
export function createWebSearchTool(config?: WebSearchToolConfig): ToolWorkflow {
  const toolId = config?.toolId ?? 'web_search';
  const defaultMaxResults = config?.maxResults ?? 5;
  const defaultTopic = config?.topic ?? 'general';

  // Search function resolved lazily — custom provider or Tavily default.
  // For Tavily, the API key is resolved at call time (not factory time).
  const searchFn: WebSearchFunction = config?.search ?? createTavilySearchFn(config ?? {});

  return defineTool(
    {
      id: toolId,
      description:
        'Search the web for current information. ' +
        'Returns a list of relevant results with titles, URLs, and content snippets.',
      inputSchema: webSearchInputSchema,
    },
    async (ctx, input: WebSearchInput) => {
      const options: WebSearchOptions = {
        maxResults: input.maxResults ?? defaultMaxResults,
        topic: input.topic ?? defaultTopic,
      };

      const result = await ctx.step.run('web_search', () => searchFn(input.query, options), {
        input: { query: input.query, options },
      });

      return result;
    }
  ) as ToolWorkflow;
}
