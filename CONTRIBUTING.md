# Contributing Guide

Polos is an open source project. We welcome contributions from everyone and strive to maintain a respectful, open, and friendly community. This guide will help you get started with contributing.

If you have questions or need help, feel free to open an issue or reach out to the maintainers. We're here to help!

## Good First Issues

We mark issues with the "good first issue" label to help new contributors find suitable tasks to start with. These are great entry points if you're new to the project.

## How to Contribute

- **Claiming an issue**: If you'd like to work on an issue, please leave a comment expressing your interest (e.g., "I'd like to work on this" or "Can I take this?"). This helps us assign the issue to you and prevents duplicate work.
- **Large features**: For significant features or changes, we recommend discussing the design and approach with maintainers first to ensure alignment before starting work.

## Setup Development Environment

### Prerequisites

- Rust (latest stable version recommended)
- PostgreSQL

### Initial Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/polos-dev/polos.git
   cd polos
   ```

2. **Install dependencies**:
   ```bash
   cd orchestrator
   cargo build
   ```

3. **Set up database**:
   - Install and start postgres
   - Create a test database: `createdb polos`
   - Set `DATABASE_URL` in `.env` file in the orchestrator directory:
     ```
     DATABASE_URL=postgres://postgres:postgres@localhost/polos
     ```

4. **Set up git hooks**:
   ```bash
   ./scripts/setup-git-hooks.sh
   ```
   
   This installs pre-commit hooks that automatically run code quality checks before each commit.

## Submit Your Code

We maintain high code quality standards. Please ensure your code is well-tested and follows our guidelines before submitting a pull request.

To submit your code:

1. **Fork the repository** on GitHub

2. **Create a new branch** on your fork:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes** and ensure:
   - Code is formatted (`cargo fmt` in orchestrator directory)
   - No clippy warnings (`cargo clippy -- -D warnings` in orchestrator directory)
   - All tests pass (`cargo test` in orchestrator directory)

4. **Run pre-commit checks**. These run automatically on `git commit` after installing the hooks (see Setup Development Environment).

   To run them manually:
   ```bash
   cd orchestrator
   cargo fmt --check
   cargo clippy -- -D warnings
   ```

5. **Open a Pull Request** when your work is ready for review

In your PR description, please include:

- A clear description of what changed
- The motivation behind the changes
- Whether this is a breaking change
- References to any related GitHub issues

A maintainer will review your PR and provide feedback. Once approved and all checks pass, your PR will be merged. We appreciate your contributions and will acknowledge them in our release notes!

## Code Quality Tools

We use `rustfmt` for code formatting and `clippy` for linting. These are automatically checked before each commit via git pre-commit hooks.

### Manual Formatting and Linting

You can run these tools manually:

**Format code:**
```bash
cd orchestrator
cargo fmt
```

**Check formatting:**
```bash
cd orchestrator
cargo fmt --check
```

**Run clippy:**
```bash
cd orchestrator
cargo clippy -- -D warnings
```

**Fix clippy suggestions automatically (when possible):**
```bash
cd orchestrator
cargo clippy --fix
```

## Running Tests

### Database Integration Tests

Tests use a PostgreSQL database specified by `TEST_DATABASE_URL`. The test setup automatically loads environment variables from a `.env` file if present.

**Run all tests:**
```bash
cd orchestrator
cargo test --test lib
```

**Run specific test:**
```bash
cd orchestrator
cargo test --test lib test_name
```

**Run with output:**
```bash
cd orchestrator
cargo test --test lib -- --nocapture
```

See `orchestrator/tests/README.md` for more details on testing.

## Code Style Guidelines

- Follow Rust naming conventions (snake_case for functions/variables, PascalCase for types)
- Keep functions focused and reasonably sized
- Add comments for complex logic
- Use meaningful variable and function names
- Prefer `anyhow::Result` for error handling in application code
- Use appropriate error types for library code

## Commit Messages

Write clear, descriptive commit messages:
- Use imperative mood ("Add feature" not "Added feature")
- Keep the first line under 72 characters
- Add more details in the body if needed

Example:
```
Add timeout support for workflow executions

- Add run_timeout_seconds field to Execution model
- Implement timeout monitoring background task
- Add cancellation logic for timed-out executions
```

## Bypassing Pre-Commit Hooks

If you need to bypass the pre-commit hook (not recommended), you can use:

```bash
git commit --no-verify
```

**Note**: This should only be used in exceptional circumstances. All code should pass formatting and linting checks before being merged.

## Questions?

If you have questions or need help, please open an issue or reach out to the maintainers.
