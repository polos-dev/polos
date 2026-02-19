import os
import subprocess

from create_polos.providers import ProviderConfig
from create_polos.templates.pyproject_toml import pyproject_toml_template
from create_polos.templates.env_example import env_example_template
from create_polos.templates.gitignore import gitignore_template
from create_polos.templates.readme import readme_template
from create_polos.templates.main_py import main_py_template
from create_polos.templates.coding_agent import coding_agent_template
from create_polos.templates.assistant_agent import assistant_agent_template
from create_polos.templates.text_review_init import text_review_init_template
from create_polos.templates.text_review_agents import text_review_agents_template
from create_polos.templates.text_review_workflow import text_review_workflow_template


def generate_files(
    project_name: str, provider: ProviderConfig
) -> list[tuple[str, str]]:
    return [
        ("pyproject.toml", pyproject_toml_template(project_name, provider)),
        (".env.example", env_example_template(provider)),
        (".gitignore", gitignore_template()),
        ("README.md", readme_template(project_name, provider)),
        ("src/main.py", main_py_template()),
        ("src/agents/__init__.py", ""),
        ("src/agents/coding_agent.py", coding_agent_template(provider)),
        ("src/agents/assistant_agent.py", assistant_agent_template(provider)),
        ("src/workflows/text_review/__init__.py", text_review_init_template()),
        ("src/workflows/text_review/agents.py", text_review_agents_template(provider)),
        ("src/workflows/text_review/workflow.py", text_review_workflow_template()),
    ]


def scaffold_project(
    project_dir: str, files: list[tuple[str, str]]
) -> None:
    for file_path, content in files:
        full_path = os.path.join(project_dir, file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)


def install_dependencies(project_dir: str) -> bool:
    try:
        subprocess.run(
            ["uv", "sync"],
            cwd=project_dir,
            capture_output=True,
            check=True,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    try:
        subprocess.run(
            ["pip", "install", "-e", "."],
            cwd=project_dir,
            capture_output=True,
            check=True,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False
