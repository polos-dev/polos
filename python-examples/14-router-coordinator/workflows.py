"""Workflow definitions for the blog review example.

Demonstrates:
1. Calling multiple agents in parallel
2. Aggregating agent outputs
3. Chaining workflows with agent calls
"""

from pydantic import BaseModel

from polos import workflow, WorkflowContext
from polos.types import AgentResult

from agents import (
    grammar_review_agent,
    tone_consistency_agent,
    correctness_agent,
    final_editor_agent,
    blog_generator_agent,
)


# ============================================================================
# Models
# ============================================================================


class BlogReviewPayload(BaseModel):
    """Input for blog review workflow."""

    text: str


class BlogReviewResult(BaseModel):
    """Result from blog review workflow."""

    original_text: str
    grammar_review: str
    tone_review: str
    correctness_review: str
    final_text: str


class GenerateBlogPayload(BaseModel):
    """Input for generate blog workflow."""

    topic: str
    additional_instructions: str | None = None


class GenerateBlogResult(BaseModel):
    """Result from generate blog workflow."""

    topic: str
    draft_blog: str
    grammar_review: str
    tone_review: str
    correctness_review: str
    final_blog: str


# ============================================================================
# Workflows
# ============================================================================


@workflow(id="blog_review")
async def blog_review(ctx: WorkflowContext, payload: BlogReviewPayload) -> BlogReviewResult:
    """Review a blog post through multiple specialist agents.

    1. Runs 3 review agents in parallel (grammar, tone, correctness)
    2. Aggregates their feedback
    3. Calls final editor agent to produce polished version
    """
    text = payload.text

    # Run all reviews in parallel
    review_results = await ctx.step.batch_agent_invoke_and_wait(
        "parallel_reviews",
        [
            grammar_review_agent.with_input(
                f"Please review the following text for grammar, spelling, and "
                f"punctuation:\n\n{text}"
            ),
            tone_consistency_agent.with_input(
                f"Please review the following text for tone consistency and style:\n\n{text}"
            ),
            correctness_agent.with_input(
                f"Please review the following text for factual accuracy and "
                f"logical consistency:\n\n{text}"
            ),
        ]
    )

    # Extract review results
    grammar_review = AgentResult.model_validate(review_results[0].result).result
    tone_review = AgentResult.model_validate(review_results[1].result).result
    correctness_review = AgentResult.model_validate(review_results[2].result).result

    # Step 2: Call final editor with all feedback
    editor_prompt = f"""Here is the original text:

{text}

Here is the feedback from our reviewers:

=== GRAMMAR REVIEW ===
{grammar_review}

=== TONE REVIEW ===
{tone_review}

=== CORRECTNESS REVIEW ===
{correctness_review}

Please produce the final polished version of the text, incorporating all valid feedback."""

    editor_result = await ctx.step.agent_invoke_and_wait(
        "final_editor",
        final_editor_agent.with_input(editor_prompt)
    )

    final_text = editor_result.result

    return BlogReviewResult(
        original_text=text,
        grammar_review=grammar_review,
        tone_review=tone_review,
        correctness_review=correctness_review,
        final_text=final_text,
    )


@workflow(id="generate_blog")
async def generate_blog(ctx: WorkflowContext, payload: GenerateBlogPayload) -> GenerateBlogResult:
    """Generate a blog post and review it.

    1. Calls blog generator agent to create initial draft
    2. Passes draft to blog_review workflow for comprehensive review
    """
    topic = payload.topic
    instructions = payload.additional_instructions or ""

    # Step 1: Generate the initial blog draft
    generator_prompt = f"Write a blog post about: {topic}"
    if instructions:
        generator_prompt += f"\n\nAdditional instructions: {instructions}"

    generator_result = await ctx.step.agent_invoke_and_wait(
        "blog_generator",
        blog_generator_agent.with_input(generator_prompt)
    )

    draft_blog = generator_result.result

    # Step 2: Send draft through blog review workflow
    review_result = await ctx.step.invoke_and_wait(
        "review_blog",
        blog_review,
        BlogReviewPayload(text=draft_blog),
    )

    # Extract review results
    grammar_review = review_result.grammar_review
    tone_review = review_result.tone_review
    correctness_review = review_result.correctness_review
    final_blog = review_result.final_text

    return GenerateBlogResult(
        topic=topic,
        draft_blog=draft_blog,
        grammar_review=grammar_review,
        tone_review=tone_review,
        correctness_review=correctness_review,
        final_blog=final_blog,
    )
