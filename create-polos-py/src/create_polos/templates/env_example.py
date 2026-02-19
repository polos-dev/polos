from create_polos.providers import ProviderConfig


def env_example_template(provider: ProviderConfig) -> str:
    return f"""{provider.env_var}={provider.env_placeholder}
"""
