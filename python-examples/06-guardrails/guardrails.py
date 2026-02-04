"""Example guardrails for validating and modifying agent responses."""

import re

from polos import guardrail, GuardrailContext, GuardrailResult, WorkflowContext


# List of blocked words/phrases
BLOCKED_PHRASES = [
    "ignore previous instructions",
    "disregard",
    "pretend you are",
    "act as if",
]

# Regex patterns for PII detection
EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")
PHONE_PATTERN = re.compile(r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b")
SSN_PATTERN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")


@guardrail
def block_prompt_injection(
    ctx: WorkflowContext, guardrail_ctx: GuardrailContext
) -> GuardrailResult:
    """Block potential prompt injection attempts in LLM responses."""
    content = guardrail_ctx.content or ""
    content_lower = content.lower()

    for phrase in BLOCKED_PHRASES:
        if phrase in content_lower:
            return GuardrailResult.fail(
                f"Response blocked: potential prompt injection detected ('{phrase}')"
            )

    return GuardrailResult.continue_with()


@guardrail
def redact_pii(
    ctx: WorkflowContext, guardrail_ctx: GuardrailContext
) -> GuardrailResult:
    """Redact PII (emails, phone numbers, SSNs) from responses."""
    content = guardrail_ctx.content or ""

    # Redact emails
    content = EMAIL_PATTERN.sub("[EMAIL REDACTED]", content)

    # Redact phone numbers
    content = PHONE_PATTERN.sub("[PHONE REDACTED]", content)

    # Redact SSNs
    content = SSN_PATTERN.sub("[SSN REDACTED]", content)

    if content != guardrail_ctx.content:
        return GuardrailResult.continue_with(modified_content=content)

    return GuardrailResult.continue_with()


@guardrail
def limit_tool_calls(
    ctx: WorkflowContext, guardrail_ctx: GuardrailContext
) -> GuardrailResult:
    """Limit the number of tool calls per turn to prevent runaway agents."""
    max_calls = 5
    tool_calls = guardrail_ctx.tool_calls or []

    if len(tool_calls) > max_calls:
        # Only allow first N tool calls
        limited_calls = tool_calls[:max_calls]
        return GuardrailResult.continue_with(modified_tool_calls=limited_calls)

    return GuardrailResult.continue_with()


@guardrail
def add_ai_disclaimer(
    ctx: WorkflowContext, guardrail_ctx: GuardrailContext
) -> GuardrailResult:
    """Add a disclaimer to AI-generated content."""
    content = guardrail_ctx.content or ""

    if content and not content.endswith("[AI Generated]"):
        modified = content + "\n\n---\n*[AI Generated Content]*"
        return GuardrailResult.continue_with(modified_content=modified)

    return GuardrailResult.continue_with()


@guardrail
def block_dangerous_tools(
    ctx: WorkflowContext, guardrail_ctx: GuardrailContext
) -> GuardrailResult:
    """Block calls to dangerous tools."""
    dangerous_tools = ["delete_file", "execute_code", "send_email"]
    tool_calls = guardrail_ctx.tool_calls or []

    for call in tool_calls:
        if call.function.name in dangerous_tools:
            return GuardrailResult.fail(
                f"Blocked: Agent attempted to call dangerous tool '{call.function.name}'"
            )

    return GuardrailResult.continue_with()


@guardrail
def enforce_response_length(
    ctx: WorkflowContext, guardrail_ctx: GuardrailContext
) -> GuardrailResult:
    """Enforce maximum response length."""
    max_length = 2000
    content = guardrail_ctx.content or ""

    if len(content) > max_length:
        truncated = content[:max_length] + "... [Response truncated]"
        return GuardrailResult.continue_with(modified_content=truncated)

    return GuardrailResult.continue_with()
