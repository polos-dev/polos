"""Web search tool -- lets agents search the web for current information.

Defaults to the Tavily Search API using httpx (no additional
dependencies beyond the SDK's existing httpx requirement).  Users can
plug in any search provider via a custom async function.

Example::

    from polos import create_web_search_tool

    # Tavily with env var (TAVILY_API_KEY)
    web_search = create_web_search_tool()

    # Custom provider
    web_search = create_web_search_tool(WebSearchToolConfig(
        search=my_custom_search_fn,
    ))
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from ..core.context import WorkflowContext
from .tool import Tool, ToolApproval

# ── Result types (provider-agnostic) ──────────────────────────────────


class WebSearchResultItem(BaseModel):
    """A single search result item."""

    title: str
    url: str
    content: str
    """Snippet or summary of the page content."""
    score: float | None = None
    """Relevance score, 0-1."""
    published_date: str | None = None
    """Publication date in ISO 8601 format."""


class WebSearchResult(BaseModel):
    """Full search result returned by the tool."""

    query: str
    results: list[WebSearchResultItem]
    answer: str | None = None
    """AI-generated summary (Tavily feature)."""


# ── Options passed to the search function ─────────────────────────────


class WebSearchOptions(BaseModel):
    """Options forwarded to the search function at call time."""

    max_results: int
    topic: Literal["general", "news"]


# ── Custom provider type ──────────────────────────────────────────────

WebSearchFunction = Callable[[str, WebSearchOptions], Awaitable[WebSearchResult]]

# ── Configuration ─────────────────────────────────────────────────────


@dataclass
class TavilySearchConfig:
    """Tavily-specific configuration knobs."""

    api_key: str | None = None
    """Tavily API key.  Falls back to the ``TAVILY_API_KEY`` environment variable."""
    search_depth: Literal["basic", "advanced"] = "basic"
    """Search depth."""
    include_answer: bool = True
    """Include an AI-generated answer in the response."""
    include_raw_content: bool = False
    """Include raw page content in results."""
    base_url: str = "https://api.tavily.com"
    """Tavily API base URL."""


@dataclass
class WebSearchToolConfig(TavilySearchConfig):
    """Configuration for :func:`create_web_search_tool`."""

    search: WebSearchFunction | None = None
    """Custom search provider.  Overrides the built-in Tavily implementation."""
    max_results: int = 5
    """Default maximum results per query."""
    topic: Literal["general", "news"] = "general"
    """Default topic filter."""
    tool_id: str = "web_search"
    """Tool identifier exposed to the LLM."""
    approval: ToolApproval | None = None
    """Require human approval before execution."""


# ── LLM-facing input schema ──────────────────────────────────────────


class WebSearchInput(BaseModel):
    """Input schema for the web_search tool."""

    query: str = Field(description="The search query")
    max_results: int | None = Field(
        default=None,
        alias="maxResults",
        description="Maximum number of results to return",
    )
    topic: Literal["general", "news"] | None = Field(
        default=None, description="Topic filter: general web search or news"
    )

    model_config = {"populate_by_name": True}


# ── Tavily implementation (internal) ──────────────────────────────────


def _create_tavily_search_fn(config: TavilySearchConfig) -> WebSearchFunction:
    """Build an async search function backed by the Tavily Search API."""

    async def _tavily_search(query: str, options: WebSearchOptions) -> WebSearchResult:
        api_key = config.api_key or os.environ.get("TAVILY_API_KEY")
        if not api_key:
            raise RuntimeError(
                "Tavily API key is required. Provide it via the api_key option "
                "or set the TAVILY_API_KEY environment variable."
            )

        base_url = config.base_url.rstrip("/")

        body = {
            "query": query,
            "max_results": options.max_results,
            "search_depth": config.search_depth,
            "include_answer": config.include_answer,
            "include_raw_content": config.include_raw_content,
            "topic": options.topic,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/search",
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )

        if response.status_code != 200:
            try:
                error_body = response.json()
                error_message = (
                    error_body.get("detail")
                    if isinstance(error_body.get("detail"), str)
                    else response.text
                )
            except Exception:
                error_message = response.text
            raise RuntimeError(f"Tavily API error ({response.status_code}): {error_message}")

        data = response.json()

        return WebSearchResult(
            query=data.get("query", query),
            answer=data.get("answer"),
            results=[
                WebSearchResultItem(
                    title=r["title"],
                    url=r["url"],
                    content=r["content"],
                    score=r.get("score"),
                    published_date=r.get("published_date"),
                )
                for r in data.get("results", [])
            ],
        )

    return _tavily_search


# ── Factory ───────────────────────────────────────────────────────────


def create_web_search_tool(config: WebSearchToolConfig | None = None) -> Tool:
    """Create a web search tool for agent use.

    By default uses the Tavily Search API via httpx.  Pass a custom
    ``search`` function to use any other provider.

    Example::

        from polos import create_web_search_tool, WebSearchToolConfig

        # Tavily with env var
        web_search = create_web_search_tool()

        # Tavily with explicit key
        web_search = create_web_search_tool(WebSearchToolConfig(api_key="tvly-xxx"))

        # Custom provider
        web_search = create_web_search_tool(WebSearchToolConfig(
            search=my_search_fn,
        ))
    """
    config = config or WebSearchToolConfig()
    tool_id = config.tool_id
    default_max_results = config.max_results
    default_topic = config.topic

    # Search function -- custom provider or Tavily default.
    # For Tavily, the API key is resolved at call time (not factory time).
    search_fn: WebSearchFunction = config.search or _create_tavily_search_fn(config)

    async def handler(ctx: WorkflowContext, input: WebSearchInput) -> dict[str, Any]:
        options = WebSearchOptions(
            max_results=input.max_results if input.max_results is not None else default_max_results,
            topic=input.topic or default_topic,
        )

        async def _do_search() -> WebSearchResult:
            return await search_fn(input.query, options)

        result: WebSearchResult = await ctx.step.run("web_search", _do_search)

        return {
            "query": result.query,
            "answer": result.answer,
            "results": [
                {
                    "title": r.title,
                    "url": r.url,
                    "content": r.content,
                    "score": r.score,
                    "publishedDate": r.published_date,
                }
                for r in result.results
            ],
        }

    async def wrapped_func(ctx: WorkflowContext, payload: dict[str, Any] | None):
        input_obj = WebSearchInput.model_validate(payload) if payload else WebSearchInput(query="")
        return await handler(ctx, input_obj)

    # Build JSON schema and remap max_results -> maxResults for LLM
    schema = WebSearchInput.model_json_schema()

    tool = Tool(
        id=tool_id,
        description=(
            "Search the web for current information. "
            "Returns a list of relevant results with titles, URLs, and content snippets."
        ),
        parameters=schema,
        func=wrapped_func,
        approval=config.approval,
    )
    tool._input_schema_class = WebSearchInput
    return tool
