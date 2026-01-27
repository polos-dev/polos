#!/bin/bash
# Setup script for git hooks
# This installs pre-commit hooks using the pre-commit framework
# Hooks include: Ruff (Python formatting/linting) and Rust (rustfmt/clippy)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Find the git repository root
if command -v git >/dev/null 2>&1; then
    GIT_ROOT="$(cd "$REPO_ROOT" && git rev-parse --show-toplevel 2>/dev/null || echo "")"
    if [ -z "$GIT_ROOT" ] || [ ! -d "$GIT_ROOT/.git" ]; then
        echo "Error: Not in a git repository."
        echo "Please run this script from within the git repository."
        exit 1
    fi
else
    # Fallback: check if .git exists in current directory or parent
    if [ -d "$REPO_ROOT/.git" ]; then
        GIT_ROOT="$REPO_ROOT"
    else
        echo "Error: git command not found and could not locate .git directory."
        exit 1
    fi
fi

# Check if pre-commit is installed
if ! command -v pre-commit >/dev/null 2>&1; then
    echo "Error: pre-commit is not installed."
    echo ""
    echo "Please install it using one of the following methods:"
    echo "  1. pip install pre-commit"
    echo "  2. brew install pre-commit  (on macOS)"
    echo "  3. Or install from sdk/python: cd sdk/python && uv sync"
    exit 1
fi

# Check if .pre-commit-config.yaml exists
if [ ! -f "$GIT_ROOT/.pre-commit-config.yaml" ]; then
    echo "Error: .pre-commit-config.yaml not found in repository root."
    echo "Git root: $GIT_ROOT"
    exit 1
fi

echo "Installing pre-commit hooks..."
cd "$GIT_ROOT"
pre-commit install

echo ""
echo "✅ Pre-commit hooks installed successfully!"
echo ""
echo "Git repository root: $GIT_ROOT"
echo ""
echo "The following hooks are now active:"
echo "  - Ruff format (Python formatting for sdk/python)"
echo "  - Ruff check (Python linting for sdk/python)"
echo "  - rustfmt (Rust formatting for orchestrator)"
echo "  - clippy (Rust linting for orchestrator)"
echo ""
echo "Hooks will run automatically before each commit."
echo "To run manually: pre-commit run --all-files"
echo "To bypass hooks (not recommended): git commit --no-verify"
