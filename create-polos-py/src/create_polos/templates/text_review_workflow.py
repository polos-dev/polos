def text_review_workflow_template() -> str:
    return '''from pydantic import BaseModel
from polos import workflow, WorkflowContext
from .agents import (
    grammar_review_agent,
    tone_consistency_agent,
    correctness_agent,
    final_editor_agent,
)


class TextReviewPayload(BaseModel):
    text: str


class TextReviewResult(BaseModel):
    original_text: str
    grammar_review: str
    tone_review: str
    correctness_review: str
    final_text: str


@workflow(id="text_review")
async def text_review(ctx: WorkflowContext, payload: TextReviewPayload) -> TextReviewResult:
    text = payload.text

    # Run 3 reviewers in parallel
    review_results = await ctx.step.batch_agent_invoke_and_wait(
        "parallel_reviews",
        [
            grammar_review_agent.with_input(f"Review this text for grammar:\\n\\n{text}"),
            tone_consistency_agent.with_input(f"Review this text for tone:\\n\\n{text}"),
            correctness_agent.with_input(f"Review this text for correctness:\\n\\n{text}"),
        ],
    )

    grammar_review = review_results[0].result.get("result", "") if review_results[0].result else ""
    tone_review = review_results[1].result.get("result", "") if review_results[1].result else ""
    correctness_review = review_results[2].result.get("result", "") if review_results[2].result else ""

    # Send all reviews to the final editor
    editor_prompt = f"""Original text:
{text}

Grammar review:
{grammar_review}

Tone review:
{tone_review}

Correctness review:
{correctness_review}

Please produce an improved version of the original text incorporating the feedback above."""

    editor_result = await ctx.step.agent_invoke_and_wait(
        "final_editor",
        final_editor_agent.with_input(editor_prompt),
    )

    final_text = editor_result.result.get("result", "") if editor_result.result else ""

    return TextReviewResult(
        original_text=text,
        grammar_review=grammar_review,
        tone_review=tone_review,
        correctness_review=correctness_review,
        final_text=final_text,
    )
'''
