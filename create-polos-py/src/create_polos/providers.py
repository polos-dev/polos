from dataclasses import dataclass


@dataclass
class ProviderConfig:
    label: str
    value: str
    provider_string: str
    model_string: str
    pip_extra: str
    env_var: str
    env_placeholder: str


PROVIDERS: list[ProviderConfig] = [
    ProviderConfig(
        label="Anthropic",
        value="anthropic",
        provider_string="anthropic",
        model_string="claude-sonnet-4-5",
        pip_extra="anthropic",
        env_var="ANTHROPIC_API_KEY",
        env_placeholder="sk-ant-...",
    ),
    ProviderConfig(
        label="OpenAI",
        value="openai",
        provider_string="openai",
        model_string="gpt-4o-mini",
        pip_extra="openai",
        env_var="OPENAI_API_KEY",
        env_placeholder="sk-...",
    ),
    ProviderConfig(
        label="Google Gemini",
        value="google",
        provider_string="gemini",
        model_string="gemini-2.0-flash",
        pip_extra="gemini",
        env_var="GOOGLE_GENERATIVE_AI_API_KEY",
        env_placeholder="AIza...",
    ),
]
