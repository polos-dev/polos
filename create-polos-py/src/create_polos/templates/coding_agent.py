from create_polos.providers import ProviderConfig


def coding_agent_template(provider: ProviderConfig) -> str:
    return f'''from polos import Agent, max_steps, MaxStepsConfig, sandbox_tools, SandboxToolsConfig

tools = sandbox_tools(
    SandboxToolsConfig(
        env="local",
        scope="session",
    )
)

coding_agent = Agent(
    id="coding_agent",
    provider="{provider.provider_string}",
    model="{provider.model_string}",
    system_prompt=(
        "You are a coding agent with access to sandbox tools. "
        "Use your tools to read, write, and execute code."
    ),
    tools=tools,
    stop_conditions=[max_steps(MaxStepsConfig(count=30))],
)
'''
