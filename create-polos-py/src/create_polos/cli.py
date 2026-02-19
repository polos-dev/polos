import os
import re

import click
from rich.console import Console
from rich.panel import Panel

from create_polos.providers import PROVIDERS
from create_polos.scaffold import generate_files, install_dependencies, scaffold_project

console = Console()


def validate_project_name(name: str) -> str | None:
    if not name:
        return "Project name is required"
    if not re.match(r"^[a-z0-9][a-z0-9._\-]*$", name):
        return "Invalid project name — use lowercase letters, numbers, hyphens, and dots"
    return None


@click.command()
@click.argument("project_name", required=False)
@click.option(
    "--provider",
    type=click.Choice([p.value for p in PROVIDERS]),
    help="LLM provider to use",
)
def main(project_name: str | None, provider: str | None) -> None:
    """Create a new Polos project."""
    console.print(
        Panel.fit(
            "[bold blue]Create a new Polos project[/bold blue]",
            border_style="blue",
        )
    )

    # Project name
    if not project_name:
        project_name = console.input(
            "\n[bold]What is your project name?[/bold] [dim](my-polos-project)[/dim] "
        ).strip()
        if not project_name:
            project_name = "my-polos-project"

    error = validate_project_name(project_name)
    if error:
        console.print(f"[red]{error}[/red]")
        raise SystemExit(1)

    # Provider selection
    if not provider:
        console.print("\n[bold]Which LLM provider do you want to use?[/bold]")
        for i, p in enumerate(PROVIDERS):
            default_marker = " [dim](default)[/dim]" if i == 0 else ""
            console.print(f"  [cyan]{i + 1}[/cyan]. {p.label}{default_marker}")

        choice = console.input("\n[bold]Enter choice[/bold] [dim](1)[/dim] ").strip()
        if not choice:
            choice = "1"

        try:
            idx = int(choice) - 1
            if idx < 0 or idx >= len(PROVIDERS):
                raise ValueError
        except ValueError:
            console.print("[red]Invalid choice[/red]")
            raise SystemExit(1)

        selected_provider = PROVIDERS[idx]
    else:
        selected_provider = next(p for p in PROVIDERS if p.value == provider)

    project_dir = os.path.join(os.getcwd(), project_name)

    if os.path.exists(project_dir):
        console.print(f'[red]Directory "{project_name}" already exists.[/red]')
        raise SystemExit(1)

    # Scaffold
    with console.status("[bold green]Creating project files..."):
        files = generate_files(project_name, selected_provider)
        scaffold_project(project_dir, files)
    console.print("[green]Project files created.[/green]")

    with console.status("[bold green]Installing dependencies..."):
        installed = install_dependencies(project_dir)
    if installed:
        console.print("[green]Dependencies installed.[/green]")
    else:
        console.print(
            "[yellow]Could not install dependencies. "
            "Run `uv sync` or `pip install -e .` manually.[/yellow]"
        )

    console.print(
        Panel(
            f"[bold green]Your project is ready![/bold green]\n\n"
            f"  [cyan]cd {project_name}[/cyan]\n"
            f"  [cyan]cp .env.example .env[/cyan]     "
            f"[dim]# add your {selected_provider.env_var}[/dim]\n"
            f"  [cyan]polos dev[/cyan]",
            title="Next steps",
            border_style="green",
        )
    )

    console.print(
        Panel(
            f"  [cyan]polos agent list[/cyan]                         "
            f"[dim]# list registered agents[/dim]\n"
            f"  [cyan]polos run assistant_agent[/cyan]                "
            f"[dim]# chat with the assistant agent[/dim]\n"
            f"  [cyan]polos run assistant_agent --input \"hi\"[/cyan]   "
            f"[dim]# one-shot mode[/dim]\n",
            title="Common commands",
            border_style="blue",
        )
    )


if __name__ == "__main__":
    main()
