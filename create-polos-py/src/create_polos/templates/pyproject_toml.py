from create_polos.providers import ProviderConfig


def pyproject_toml_template(project_name: str, provider: ProviderConfig) -> str:
    return f"""[project]
name = "{project_name}"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "polos-sdk[{provider.pip_extra}]",
    "python-dotenv>=1.0.0",
]
"""
