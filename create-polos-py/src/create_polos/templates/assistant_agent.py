from create_polos.providers import ProviderConfig


def assistant_agent_template(provider: ProviderConfig) -> str:
    return f'''from polos import (
    Agent,
    max_steps,
    MaxStepsConfig,
    sandbox_tools,
    SandboxToolsConfig,
)

sandbox = sandbox_tools(
    SandboxToolsConfig(
        env="local",
    )
)

assistant_agent = Agent(
    id="assistant_agent",
    provider="{provider.provider_string}",
    model="{provider.model_string}",
    system_prompt=(
        "You are a helpful assistant with access to sandbox tools. "
        "Use your tools to help the user with their tasks."
    ),
    tools=[*sandbox],
    stop_conditions=[max_steps(MaxStepsConfig(count=30))],
)
'''
