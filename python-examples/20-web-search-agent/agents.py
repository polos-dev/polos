"""Research agent with web search and ask-user tools.

The agent can search the web for current information using the Tavily
Search API and ask the user follow-up questions to refine its research.
"""

from polos import (
    Agent,
    max_steps,
    MaxStepsConfig,
    create_web_search_tool,
    WebSearchToolConfig,
    create_ask_user_tool,
)

# Web search tool -- uses Tavily API via TAVILY_API_KEY env var.
# The API key is resolved lazily at call time, not at import time.
web_search = create_web_search_tool(
    WebSearchToolConfig(
        max_results=5,
        search_depth="basic",
        include_answer=True,
        approval="always",
    )
)

# Ask-user tool -- lets the agent ask the user for clarification
ask_user = create_ask_user_tool()

# Research agent that combines web search with user interaction
research_agent = Agent(
    id="research_agent",
    provider="anthropic",
    model="claude-sonnet-4-5",
    system_prompt=(
        "You are a research assistant with access to web search. "
        "When the user asks a question, search the web for current information and "
        "synthesize a well-sourced answer. Include URLs from your search results as references. "
        "If the user's question is ambiguous, use the ask_user tool to clarify before searching. "
        "You may perform multiple searches to gather comprehensive information. "
        "Always cite your sources with URLs in the final answer."
    ),
    tools=[web_search, ask_user],
    stop_conditions=[max_steps(MaxStepsConfig(count=30))],
)
