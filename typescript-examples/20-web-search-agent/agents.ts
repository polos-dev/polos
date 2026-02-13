/**
 * Research agent with web search and ask-user tools.
 *
 * The agent can search the web for current information using the Tavily
 * Search API and ask the user follow-up questions to refine its research.
 */

import { defineAgent, maxSteps, createWebSearchTool, createAskUserTool } from '@polos/sdk';
import { anthropic } from '@ai-sdk/anthropic';

// Web search tool — uses Tavily API via TAVILY_API_KEY env var.
// The API key is resolved lazily at call time, not at import time.
export const webSearch = createWebSearchTool({
  maxResults: 5,
  searchDepth: 'basic',
  includeAnswer: true,
  approval: 'always',
});

// Ask-user tool — lets the agent ask the user for clarification
export const askUser = createAskUserTool();

// Research agent that combines web search with user interaction
export const researchAgent = defineAgent({
  id: 'research_agent',
  model: anthropic('claude-sonnet-4-5'),
  systemPrompt:
    'You are a research assistant with access to web search. ' +
    'When the user asks a question, search the web for current information and ' +
    'synthesize a well-sourced answer. Include URLs from your search results as references. ' +
    'If the user\'s question is ambiguous, use the ask_user tool to clarify before searching. ' +
    'You may perform multiple searches to gather comprehensive information. ' +
    'Always cite your sources with URLs in the final answer.',
  tools: [webSearch, askUser],
  stopConditions: [maxSteps({ count: 30 })],
});
