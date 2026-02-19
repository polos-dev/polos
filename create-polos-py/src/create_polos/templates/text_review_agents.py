from create_polos.providers import ProviderConfig


def text_review_agents_template(provider: ProviderConfig) -> str:
    return f'''from polos import Agent, max_steps, MaxStepsConfig

grammar_review_agent = Agent(
    id="grammar_reviewer",
    provider="{provider.provider_string}",
    model="{provider.model_string}",
    system_prompt=(
        "You are a grammar reviewer. Analyze the provided text for grammatical errors, "
        "punctuation issues, and sentence structure problems. Provide a concise review "
        "with specific suggestions for improvement. Return your review as a single string."
    ),
    stop_conditions=[max_steps(MaxStepsConfig(count=10))],
)

tone_consistency_agent = Agent(
    id="tone_reviewer",
    provider="{provider.provider_string}",
    model="{provider.model_string}",
    system_prompt=(
        "You are a tone and consistency reviewer. Analyze the provided text for tone shifts, "
        "inconsistencies in voice, and style issues. Provide a concise review with specific "
        "suggestions for improvement. Return your review as a single string."
    ),
    stop_conditions=[max_steps(MaxStepsConfig(count=10))],
)

correctness_agent = Agent(
    id="correctness_reviewer",
    provider="{provider.provider_string}",
    model="{provider.model_string}",
    system_prompt=(
        "You are a factual correctness reviewer. Analyze the provided text for factual accuracy, "
        "logical consistency, and unsupported claims. Provide a concise review with specific "
        "concerns. Return your review as a single string."
    ),
    stop_conditions=[max_steps(MaxStepsConfig(count=10))],
)

final_editor_agent = Agent(
    id="final_editor",
    provider="{provider.provider_string}",
    model="{provider.model_string}",
    system_prompt=(
        "You are a final editor. You will receive the original text along with reviews from "
        "grammar, tone, and correctness reviewers. Synthesize all feedback and produce an "
        "improved version of the text. Return only the improved text."
    ),
    stop_conditions=[max_steps(MaxStepsConfig(count=10))],
)
'''
