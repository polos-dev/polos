"""Tests for the web_search tool -- matches TypeScript web-search.test.ts."""

import os
from unittest.mock import AsyncMock, MagicMock

import pytest

from polos.core.context import WorkflowContext
from polos.core.workflow import _WORKFLOW_REGISTRY
from polos.tools.web_search import (
    WebSearchOptions,
    WebSearchResult,
    WebSearchResultItem,
    WebSearchToolConfig,
    create_web_search_tool,
)


def _make_ctx() -> WorkflowContext:
    ctx = WorkflowContext(
        workflow_id="test-wf",
        execution_id="exec-1",
        deployment_id="deploy-1",
        session_id="sess-1",
    )
    ctx.step = MagicMock()
    ctx.step.uuid = AsyncMock(return_value="uuid-789")
    ctx.step.suspend = AsyncMock()

    # step.run should call the async function and return its result
    async def _mock_step_run(key, fn, *a, **kw):
        return await fn()

    ctx.step.run = AsyncMock(side_effect=_mock_step_run)
    return ctx


async def _noop_search(query: str, options: WebSearchOptions) -> WebSearchResult:
    return WebSearchResult(query=query, results=[])


class TestCreateWebSearchTool:
    """Tests matching the TypeScript web-search.test.ts."""

    def test_creates_a_tool_with_default_id_web_search(self):
        tool = create_web_search_tool(WebSearchToolConfig(search=_noop_search))
        assert tool.id == "web_search"

    def test_supports_custom_tool_id(self):
        tool = create_web_search_tool(WebSearchToolConfig(tool_id="my_search", search=_noop_search))
        assert tool.id == "my_search"

    def test_has_valid_llm_tool_definition(self):
        tool = create_web_search_tool(WebSearchToolConfig(search=_noop_search))
        defn = tool.to_llm_tool_definition()

        assert defn["type"] == "function"
        assert defn["function"]["name"] == "web_search"
        assert defn["function"]["description"]
        assert isinstance(defn["function"]["parameters"], dict)
        assert "properties" in defn["function"]["parameters"]

        props = defn["function"]["parameters"]["properties"]
        assert "query" in props
        assert "maxResults" in props or "max_results" in props
        assert "topic" in props

    def test_query_is_required_max_results_and_topic_are_optional(self):
        tool = create_web_search_tool(WebSearchToolConfig(search=_noop_search))
        defn = tool.to_llm_tool_definition()
        required = defn["function"]["parameters"].get("required", [])

        assert "query" in required
        assert "maxResults" not in required
        assert "max_results" not in required
        assert "topic" not in required

    def test_is_auto_registered_in_the_global_registry(self):
        tool = create_web_search_tool(WebSearchToolConfig(search=_noop_search))
        assert "web_search" in _WORKFLOW_REGISTRY
        assert _WORKFLOW_REGISTRY["web_search"] is tool

    def test_accepts_a_custom_search_function(self):
        async def custom_search(query: str, opts: WebSearchOptions) -> WebSearchResult:
            return WebSearchResult(
                query=query,
                results=[
                    WebSearchResultItem(
                        title="Test", url="https://example.com", content="Test content"
                    )
                ],
            )

        tool = create_web_search_tool(WebSearchToolConfig(search=custom_search))
        assert tool.id == "web_search"

    def test_accepts_approval_option_and_produces_a_valid_tool(self):
        tool = create_web_search_tool(WebSearchToolConfig(approval="always", search=_noop_search))
        assert tool.id == "web_search"
        assert tool._approval == "always"

        defn = tool.to_llm_tool_definition()
        assert defn["type"] == "function"
        assert defn["function"]["name"] == "web_search"
        assert defn["function"]["description"]

    def test_tavily_api_key_error_is_descriptive_when_missing(self):
        """Factory succeeds even without an API key (lazy resolution)."""
        original_env = os.environ.get("TAVILY_API_KEY")
        os.environ.pop("TAVILY_API_KEY", None)

        try:
            tool = create_web_search_tool()
            assert tool is not None
            assert tool.id == "web_search"
        finally:
            if original_env is not None:
                os.environ["TAVILY_API_KEY"] = original_env


class TestWebSearchToolHandler:
    """Tests for the web_search handler behavior."""

    @pytest.mark.asyncio
    async def test_calls_custom_search_function(self):
        calls: list[tuple[str, WebSearchOptions]] = []

        async def tracking_search(query: str, opts: WebSearchOptions) -> WebSearchResult:
            calls.append((query, opts))
            return WebSearchResult(
                query=query,
                results=[
                    WebSearchResultItem(
                        title="Result 1",
                        url="https://example.com",
                        content="Content 1",
                        score=0.95,
                    )
                ],
                answer="Summary answer",
            )

        tool = create_web_search_tool(WebSearchToolConfig(search=tracking_search))
        ctx = _make_ctx()

        result = await tool.func(ctx, {"query": "test query"})

        assert len(calls) == 1
        assert calls[0][0] == "test query"
        assert calls[0][1].max_results == 5
        assert calls[0][1].topic == "general"

        assert result["query"] == "test query"
        assert result["answer"] == "Summary answer"
        assert len(result["results"]) == 1
        assert result["results"][0]["title"] == "Result 1"
        assert result["results"][0]["score"] == 0.95

    @pytest.mark.asyncio
    async def test_passes_max_results_and_topic_from_input(self):
        calls: list[tuple[str, WebSearchOptions]] = []

        async def tracking_search(query: str, opts: WebSearchOptions) -> WebSearchResult:
            calls.append((query, opts))
            return WebSearchResult(query=query, results=[])

        tool = create_web_search_tool(WebSearchToolConfig(search=tracking_search))
        ctx = _make_ctx()

        await tool.func(ctx, {"query": "news", "maxResults": 10, "topic": "news"})

        assert calls[0][1].max_results == 10
        assert calls[0][1].topic == "news"

    @pytest.mark.asyncio
    async def test_uses_config_defaults_when_input_omits_options(self):
        calls: list[tuple[str, WebSearchOptions]] = []

        async def tracking_search(query: str, opts: WebSearchOptions) -> WebSearchResult:
            calls.append((query, opts))
            return WebSearchResult(query=query, results=[])

        tool = create_web_search_tool(
            WebSearchToolConfig(
                search=tracking_search,
                max_results=3,
                topic="news",
            )
        )
        ctx = _make_ctx()

        await tool.func(ctx, {"query": "hello"})

        assert calls[0][1].max_results == 3
        assert calls[0][1].topic == "news"

    @pytest.mark.asyncio
    async def test_wraps_search_in_step_run(self):
        """The search call is wrapped in ctx.step.run for durable execution."""
        tool = create_web_search_tool(WebSearchToolConfig(search=_noop_search))
        ctx = _make_ctx()

        await tool.func(ctx, {"query": "test"})

        ctx.step.run.assert_called_once()
        call_args = ctx.step.run.call_args
        assert call_args[0][0] == "web_search"
