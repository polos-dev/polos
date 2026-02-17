"""Type definitions for agent execution steps, tool calls, and usage."""

from typing import Any

from pydantic import BaseModel, ConfigDict


class Usage(BaseModel):
    """Token usage information from LLM calls."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cache_read_input_tokens: int | None = None
    cache_creation_input_tokens: int | None = None


class ToolCallFunction(BaseModel):
    """Function information within a tool call."""

    name: str
    arguments: str  # JSON string


class ToolCall(BaseModel):
    """A tool call made by the LLM."""

    id: str
    type: str = "function"
    function: ToolCallFunction
    call_id: str | None = None


class ToolResult(BaseModel):
    """Result from executing a tool."""

    tool_name: str
    status: str  # completed, failed
    result: Any | None = None
    result_schema: str | None = None
    error: str | None = None
    tool_call_id: str
    tool_call_call_id: str


class Step(BaseModel):
    """A step in agent execution."""

    step: int
    content: Any | None = None
    tool_calls: list[ToolCall] = []
    tool_results: list[ToolResult] = []
    usage: Usage | None = None
    raw_output: Any | None = None


class BatchWorkflowInput(BaseModel):
    """Input for batch workflow invocation.

    Attributes:
        id: The workflow ID to invoke
        payload: The payload to pass to the workflow (can be dict or Pydantic model)
    """

    id: str
    payload: Any | None = None
    initial_state: BaseModel | dict[str, Any] | None = None
    run_timeout_seconds: int | None = None


class BatchStepResult(BaseModel):
    """Result of a batch workflow invocation.

    Attributes:
        workflow_id: The workflow ID that was invoked
        success: Whether the workflow completed successfully
        result: The result from the workflow (if successful)
        error: Error message (if failed)
    """

    # Ignore extra fields that may be added by the orchestrator
    model_config = ConfigDict(extra="ignore")

    workflow_id: str
    success: bool
    result: Any | None = None
    error: str | None = None


class AgentResult(BaseModel):
    """Final result returned from an agent stream/run execution."""

    agent_run_id: str
    result: Any | None = None
    result_schema: str | None = None
    tool_results: list[ToolResult] = []
    total_steps: int
    usage: Usage


class AgentConfig(BaseModel):
    """Configuration for agent execution."""

    name: str
    provider: str
    model: str
    tools: list[dict[str, Any]] = []
    system_prompt: str | None = None
    max_output_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    provider_base_url: str | None = None
    provider_llm_api: str | None = None
    provider_kwargs: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None
    output_schema_name: str | None = None
    guardrail_max_retries: int | None = None
