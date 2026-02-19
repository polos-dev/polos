# 20 - Web Search Agent

An interactive research agent that searches the web, streams its activity to the terminal, and can ask follow-up questions.

## What it demonstrates

- `createWebSearchTool()` gives an agent web search via the Tavily API (no extra npm dependencies)
- `createAskUserTool()` lets the agent ask the user for clarification mid-run
- **Streaming** — tool calls and text deltas are printed to the terminal as they arrive
- **Suspend/resume** — when the agent calls `ask_user`, the workflow suspends, the terminal prompts the user, and the workflow resumes with their answer
- The API key is resolved lazily at call time, not at import time

## Prerequisites

- **Polos server** running (`polos server start`)
- **Anthropic API key** (or swap to OpenAI in `agents.ts`)
- **Tavily API key** — get a free one at [tavily.com](https://tavily.com)

## Setup

```bash
cp .env.example .env
# Edit .env with your project ID and API keys
npm install
```

## Run

```bash
npx tsx main.ts
```

The client will:
1. Prompt you for a research question
2. Stream the agent's activity (web searches, text output)
3. If the agent needs clarification, prompt you in the terminal
4. Display the final researched answer with sources

## How it works

```typescript
import {
  defineAgent, createWebSearchTool, createAskUserTool
} from '@polos/sdk';

// Tavily search — reads TAVILY_API_KEY from env
const webSearch = createWebSearchTool({ maxResults: 5 });
const askUser = createAskUserTool();

const agent = defineAgent({
  id: 'research_agent',
  model: anthropic('claude-sonnet-4-5'),
  tools: [webSearch, askUser],
});
```

The client uses `polos.invoke()` + `polos.events.streamWorkflow()` to stream events. When a `suspend_ask_user` event arrives, it prompts the user and calls `polos.resume()` to continue the workflow.

### Custom search provider

Plug in any search API — Brave, Serper, SerpAPI, etc.:

```typescript
const webSearch = createWebSearchTool({
  search: async (query, opts) => {
    const res = await fetch(`https://my-search-api.com?q=${query}&n=${opts.maxResults}`);
    const data = await res.json();
    return {
      query,
      results: data.items.map((item: any) => ({
        title: item.title,
        url: item.link,
        content: item.snippet,
      })),
    };
  },
});
```

### Tavily options

```typescript
createWebSearchTool({
  apiKey: 'tvly-xxx',        // or use TAVILY_API_KEY env var
  searchDepth: 'advanced',   // 'basic' (default) or 'advanced'
  maxResults: 10,            // default: 5
  topic: 'news',             // 'general' (default) or 'news'
  includeAnswer: true,       // AI-generated summary (default: true)
  includeRawContent: false,  // full page content (default: false)
});
```
