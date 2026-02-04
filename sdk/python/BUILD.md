# Building and Releasing Polos Python SDK

This document describes how to build, test, and release the `polos-sdk` Python package.

## Prerequisites

- Python 3.10+ installed
- [UV](https://github.com/astral-sh/uv) (recommended) or `pip` and `build`
- Git access to the repository
- PyPI account (for publishing releases)

## Local Development

### Setup

```bash
cd sdk/python

# Using UV (recommended)
uv sync --dev

# Or using pip
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -e ".[dev]"
```

### Running Tests

```bash
# Using UV
uv run pytest

# Or using pip
pytest

# With coverage
uv run pytest --cov=polos --cov-report=html
```

### Code Quality

```bash
# Format code
uv run ruff format .

# Lint code
uv run ruff check .

# Auto-fix linting issues
uv run ruff check --fix .
```

#### Using uvx (Alternative)

If `uv run` fails due to version detection issues (e.g., missing git tags), use `uvx` to run tools directly without building the package:

```bash
# Format code
uvx ruff format .

# Lint code
uvx ruff check .

# Auto-fix linting issues
uvx ruff check --fix .
```

`uvx` runs the tool in an isolated environment without needing to install or build the SDK package.

## Building the Package

### Build Locally

```bash
cd sdk/python

# Install build tools
pip install build hatchling hatch-vcs

# Build package (creates sdist and wheel in dist/)
python -m build
```

This will create:
- `dist/polos-sdk-<version>.tar.gz` (source distribution)
- `dist/polos-sdk-<version>-py3-none-any.whl` (wheel distribution)

### Verify the Build

```bash
# Check package metadata
python -m pip install --upgrade pip
pip install twine
twine check dist/*
```

### Test Installation

```bash
# Install from local build
pip install dist/polos-sdk-*.whl

# Or install from source
pip install dist/polos-sdk-*.tar.gz

# Verify installation
python -c "import polos; print(polos.__version__)"
```

## Version Management

The package uses [hatch-vcs](https://github.com/ofek/hatch-vcs) for automatic version management from Git tags.

- Version is automatically derived from Git tags matching `python-sdk-v*`
- Tag format: `python-sdk-v<version>` (e.g., `python-sdk-v0.1.0`)
- The version in `pyproject.toml` is set to `dynamic = ["version"]`
- During build, `hatch-vcs` extracts the version from the Git tag

### Manual Version Check

To see what version would be built from the current Git state:

```bash
cd sdk/python
python -c "from hatchling.build import build_sdist; import os; os.chdir('.'); print(build_sdist('dist'))"
```

Or check the Git tags:

```bash
git tag -l "python-sdk-v*"
```

## Releasing to PyPI

### Release Process

The release process is automated via GitHub Actions. To create a release:

#### 1. Ensure Code is Ready

```bash
# Make sure all changes are committed
git status

# Run tests locally
cd sdk/python
uv run pytest

# Check code quality
uv run ruff format .
uv run ruff check .
```

#### 2. Commit and Push Changes

```bash
git add .
git commit -m "Prepare for release v0.1.0"
git push origin main  # or your branch name
```

#### 3. Create and Push Release Tag

```bash
# Create the tag (must match pattern: python-sdk-v*)
git tag python-sdk-v0.1.0

# Push the tag to trigger the release workflow
git push origin python-sdk-v0.1.0

# Or push all tags
git push origin --tags
```

#### 4. Monitor the Release

1. Go to your GitHub repository
2. Click the "Actions" tab
3. Find the "Release Python SDK" workflow run
4. The workflow will:
   - ✅ Run tests on Python 3.10, 3.11, 3.12
   - ✅ Build the package (sdist + wheel)
   - ✅ Validate the package with `twine check`
   - ✅ Create a GitHub Release with artifacts
   - ✅ Publish to PyPI

#### 5. Verify the Release

After the workflow completes:

**GitHub Release:**
- Visit: `https://github.com/polos-dev/polos/releases`
- You should see the new release with download links

**PyPI:**
- Visit: `https://pypi.org/project/polos-sdk/`
- The new version should be listed

**Installation Test:**
```bash
pip install polos-sdk
python -c "import polos; print(polos.__version__)"
```

### Manual Release (Alternative)

If you need to release manually without GitHub Actions:

```bash
cd sdk/python

# 1. Ensure you're on the correct tag
git checkout python-sdk-v0.1.0

# 2. Build the package
python -m build

# 3. Verify the build
twine check dist/*

# 4. Upload to PyPI
twine upload dist/* \
  --username __token__ \
  --password <your-pypi-api-token>
```

## Release Notes

The GitHub Actions workflow automatically generates release notes from commits between tags:

- For the first release: All commits up to the tag
- For subsequent releases: Commits since the last `python-sdk-v*` tag

You can edit the release notes in the GitHub Release after it's created.

## Troubleshooting

### Build Fails: "No tags found"

**Problem**: `hatch-vcs` can't find a matching Git tag.

**Solution**: 
- Ensure you're in a Git repository
- Check that tags exist: `git tag -l "python-sdk-v*"`
- Make sure you've fetched tags: `git fetch --tags`
- For local builds, you may need to be on a tagged commit

### Version Extraction Fails

**Problem**: Version can't be extracted from tag.

**Solution**:
- Ensure tag format is exactly `python-sdk-v<version>` (e.g., `python-sdk-v0.1.0`)
- Check `pyproject.toml` has `tag-pattern = "python-sdk-v(?P<version>.*)"` in `[tool.hatch.version]`

### PyPI Upload Fails: 401 Unauthorized

**Problem**: Authentication failed.

**Solution**:
- Verify `PYPI_API_TOKEN` is set in GitHub Secrets
- Check the token hasn't expired or been revoked
- Ensure the token has the correct scope (entire account or project-specific)

### Tests Fail in CI

**Problem**: Tests pass locally but fail in GitHub Actions.

**Solution**:
- Check the test output in the Actions tab
- Ensure all dependencies are listed in `pyproject.toml`
- Verify Python version compatibility
- Check for environment-specific issues

## Package Structure

```
sdk/python/
├── polos/              # Main package
│   ├── __init__.py     # Package initialization (includes __version__)
│   ├── agents/         # Agent implementation
│   ├── core/           # Core workflow/step/context
│   ├── features/       # Events, schedules, tracing
│   ├── llm/            # LLM providers
│   ├── middleware/     # Hooks and guardrails
│   ├── runtime/        # Worker and client
│   ├── tools/          # Tool implementation
│   ├── types/          # Type definitions
│   └── utils/          # Utility functions
├── tests/              # Test suite
├── pyproject.toml      # Package configuration
├── README.md           # Package documentation
└── BUILD.md            # This file
```

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

Examples:
- `python-sdk-v0.1.0` - Initial release
- `python-sdk-v0.1.1` - Patch release (bug fixes)
- `python-sdk-v0.2.0` - Minor release (new features)
- `python-sdk-v1.0.0` - Major release (breaking changes)

## Related Documentation

- [Package README](./README.md) - User-facing documentation
- [GitHub Actions Workflow](../.github/workflows/release-python-sdk.yml) - Automated release workflow
- [PyPI Project](https://pypi.org/project/polos-sdk/) - Published package page

## Support

For issues or questions:
- 📖 [Documentation](https://docs.polos.dev)
- 💬 [Discord Community](https://discord.gg/polos)
- 🐛 [Issue Tracker](https://github.com/polos-dev/polos/issues)
