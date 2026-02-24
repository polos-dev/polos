# CLAUDE.md — Polos Developer Guide

Polos is the open-source runtime for AI agents. You write the agent; Polos handles sandboxes, durability, approvals, triggers, and observability.

**Docs**: https://polos.dev/docs | **Repo**: https://github.com/polos-dev/polos | **Discord**: https://discord.gg/ZAxHKMPwFG

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   polos CLI (Rust)                       │
│        Single binary embedding orchestrator + UI        │
├──────────────────────┬──────────────────────────────────┤
│  Orchestrator (Rust) │         UI (React/TS)            │
│  Axum + Tokio        │    Vite + Tailwind + Shadcn      │
│  PostgreSQL (SQLx)   │    localhost:5173                 │
│  localhost:8080      │                                   │
├──────────────────────┴──────────────────────────────────┤
│              Worker (Python or TypeScript SDK)           │
│  Executes agents/workflows, connects to orchestrator    │
└─────────────────────────────────────────────────────────┘
```

**Orchestrator** (`orchestrator/`) — Core execution engine: durable logs, retries, scheduling, triggers, sandbox management. Rust with Axum, Tokio, SQLx (PostgreSQL).

**CLI** (`server/`) — The `polos` binary. Manages orchestrator and UI processes. Rust with Clap.

**UI** (`ui/`) — React 19 dashboard for monitoring agents, workflows, traces. Vite, TypeScript, Tailwind CSS, Shadcn/Radix UI.

**Python SDK** (`sdk/python/`) — Agent/workflow definitions, tool system, worker runtime. Pydantic, FastAPI, OpenTelemetry.

**TypeScript SDK** (`sdk/typescript/`) — Same capabilities as Python SDK. Fastify, Vercel AI SDK, OpenTelemetry.

## Repository Layout

```
orchestrator/          Rust orchestrator (Axum API server + execution engine)
  migrations/          PostgreSQL migration files (0001–0004)
  src/                 Source code (lib.rs entry point)
  tests/               Integration tests (require DB)
server/                Rust CLI binary (embeds orchestrator + UI at build time)
ui/                    React/TypeScript dashboard
  src/                 Components, pages, hooks, API client
sdk/python/            Python SDK (polos-sdk on PyPI)
  polos/               Package source
  tests/               pytest test suite
sdk/typescript/        TypeScript SDK (@polos/sdk on npm)
  src/                 Package source
  tests/               Test files (*.test.ts)
python-examples/       20+ example agent projects (Python)
typescript-examples/   20+ example agent projects (TypeScript)
create-polos-py/       Python project scaffolder (Click CLI)
create-polos-ts/       TypeScript project scaffolder (Clack prompts)
docs/                  Documentation site (polos.dev)
DESIGN/                Architecture and design documents
scripts/               Build and dev setup scripts
```

## Prerequisites

- **Rust** (latest stable) — for orchestrator and CLI
- **Node.js 18+** and **npm** — for UI and TypeScript SDK
- **Python 3.10+** — for Python SDK
- **PostgreSQL** — running locally
- **uv** (recommended) or pip — for Python dependency management

## Development Setup

### Full build from source

```bash
./scripts/dev-setup.sh            # Build everything, install to ~/.polos
./scripts/dev-setup.sh --release  # Release mode
./scripts/dev-setup.sh --skip-ui  # Skip UI build
```

This builds orchestrator, CLI, UI, and installs both SDKs. Add `~/.polos/bin` to your `PATH`.

### Database setup

```bash
createdb polos_local
createdb polos_test    # for integration tests
```

The orchestrator auto-runs migrations on startup. Config is in `orchestrator/.env`:
```
DATABASE_URL="postgres://postgres:postgres@localhost/polos_local"
TEST_DATABASE_URL="postgres://postgres:postgres@localhost/polos_test"
POLOS_LOCAL_MODE=true
POLOS_BIND_ADDRESS=127.0.0.1:8080
```

### Individual component builds

**Orchestrator:**
```bash
cd orchestrator && cargo build
cargo test           # requires PostgreSQL + TEST_DATABASE_URL
```

**CLI:**
```bash
cd server && cargo build
# Binary at server/target/debug/polos
```

**UI:**
```bash
cd ui && npm install
npm run dev          # Dev server at localhost:5173
npm run build        # Production build
npm test             # Vitest
```

**Python SDK:**
```bash
cd sdk/python
uv pip install -e ".[dev]"   # or: pip install -e ".[dev]"
pytest                        # Run tests
```

**TypeScript SDK:**
```bash
cd sdk/typescript
npm install && npm run build   # Build with tsup
npm test                       # Run tests
npm link                       # Link for local development
```

### Running locally

```bash
polos dev                  # Start orchestrator + UI + worker (hot reload)
polos run <agent>          # Interactive agent session
polos server start         # Start just the server
polos agent list           # List registered agents
polos tool list            # List available tools
polos logs <agent>         # Stream agent logs
```

- Dashboard: http://localhost:5173
- API: http://localhost:8080

## Code Quality

### Git hooks

```bash
./scripts/setup-git-hooks.sh   # Install pre-commit hooks
# or: pre-commit install
```

Pre-commit runs automatically: Ruff (Python), rustfmt + clippy (Rust), Husky + lint-staged (UI).

### Formatting & linting

**Python** (Ruff — line length 100, Python 3.10+):
```bash
ruff format sdk/python/
ruff check --fix sdk/python/
```

**Rust** (rustfmt + clippy):
```bash
cd orchestrator && cargo fmt
cargo clippy -- -D warnings
```

**UI** (ESLint + Prettier):
```bash
cd ui
npm run lint
npm run format
```

### Testing

```bash
# Python SDK
cd sdk/python && pytest

# TypeScript SDK
cd sdk/typescript && npm test

# Rust orchestrator (needs TEST_DATABASE_URL)
cd orchestrator && cargo test

# UI
cd ui && npm test
```

## Commit Conventions

- Use imperative mood: "Add feature" not "Added feature"
- Prefix with component: `sdk/python:`, `sdk/typescript:`, `ui:`, `orchestrator:`, `cli:`, `create-polos-py:`, `create-polos-ts:`
- Keep subject line under 72 characters
- Examples:
  - `sdk/python: Support LiteLLM`
  - `ui: Add link to trace detail page from session details`
  - `cli: Remove HTTP timeout during streaming of events`

## SDK Overview

### Python SDK key modules (`sdk/python/polos/`)

- `agents/` — Agent definitions and decorators
- `core/` — Core execution engine
- `execution/` — Session and execution management
- `tools/` — Tool system and sandbox tools (Docker, E2B)
- `llm/` — LLM provider integrations (Anthropic, OpenAI, LiteLLM)
- `channels/` — Communication channels (Slack)
- `runtime/` — Worker runtime (FastAPI-based)
- `memory/` — Conversation memory
- `frameworks/` — External framework support (LangGraph, CrewAI, Mastra)

### TypeScript SDK key modules (`sdk/typescript/src/`)

- Same structure: `agents/`, `core/`, `execution/`, `tools/`, `channels/`, `runtime/`
- Uses Vercel AI SDK for LLM providers (Anthropic, OpenAI, Google, Groq, Azure)

### LLM provider dependencies

Python optional extras: `anthropic`, `openai`, `litellm`, `ollama`, `gemini`, `groq`, `fireworks`, `together`, `all`

```bash
pip install polos-sdk[anthropic]    # Just Anthropic
pip install polos-sdk[all]          # All providers
```

## Database Migrations

Migrations live in `orchestrator/migrations/` and run automatically on startup:
- `0001_initial_schema.sql` — Core tables
- `0002_add_queue_name_to_event_triggers.sql` — Event triggers
- `0003_add_session_memory.sql` — Session memory
- `0004_add_channel_context_and_slack_apps.sql` — Slack integration

New migrations: add `NNNN_description.sql` following the sequential numbering.

## CI/CD

Release workflows in `.github/workflows/`:
- `release.yml` — Cross-compile CLI for 4 platforms (darwin-arm64, darwin-x86_64, linux-arm64, linux-x86_64), upload to GitHub Releases
- `release-python-sdk.yml` — Publish to PyPI
- `release-typescript-sdk.yml` — Publish to npm
- `release-create-polos-py.yml` / `release-create-polos-ts.yml` — Scaffolder releases

Tags: `v*` triggers CLI release. SDK tags: `python-sdk-v*`, `typescript-sdk-v*`.

## Examples

`python-examples/` and `typescript-examples/` contain 20+ example projects covering agents with tools, structured output, streaming, workflows, state persistence, scheduled/event-triggered workflows, sandbox tools, Slack integration, and more. Use these as reference when building new features or writing tests.
