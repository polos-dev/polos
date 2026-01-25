# Orchestrator Tests

## Overview

These are **database integration tests** that test the database layer directly. They do NOT require the orchestrator HTTP server to be running.

Tests connect to a PostgreSQL database specified by the `TEST_DATABASE_URL` environment variable.

## Quick Start

### Setup

1. **Create a test database**:
   ```bash
   createdb polos_test
   ```

2. **Set TEST_DATABASE_URL** (either in `.env` file or as environment variable):
   ```bash
   # In .env file (recommended)
   TEST_DATABASE_URL=postgres://postgres:postgres@localhost/polos_test
   
   # Or export as environment variable
   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost/polos_test"
   ```

3. **Run tests**:
   ```bash
   cd orchestrator
   cargo test
   ```

### Running Specific Tests

**Run specific test module**:
```bash
# Run all tests in a module (use test name pattern)
cargo test --test lib db::executions_test

# Or run all tests matching a pattern
cargo test --test lib executions_test
```

**Run a specific test**:
```bash
# By test name
cargo test --test lib test_cancel_execution_recursively_cancels_children

# Or use a pattern to match multiple tests
cargo test --test lib test_cancel_execution
```

**Run with output**:
```bash
cargo test -- --nocapture
```

## How It Works

Tests use `setup_test_db()` from `tests/common.rs`, which:
1. Loads environment variables from `.env` file (if present) using `dotenv`
2. Reads `TEST_DATABASE_URL` from environment
3. Creates a connection pool and runs migrations
4. Returns a `Database` instance for the test to use

**Test Isolation**: Tests are isolated by using unique UUIDs for all test data (projects, deployments, workflows, executions, etc.). Each test creates its own data with unique identifiers, so tests don't interfere with each other.

## Test Structure

- `tests/common.rs` - Shared test utilities and helpers
  - `setup_test_db()` - Main test database setup (uses TEST_DATABASE_URL)
  - `create_test_project()`, `create_test_deployment()`, `create_test_workflow()`, `create_test_worker()` - Test data helpers
- `tests/db/*_test.rs` - Database integration tests for each module
- Tests use `#[tokio::test]` and call `setup_test_db()` to get a database instance

## Environment Variables

Tests read the following environment variables (from `.env` file or environment):

- `TEST_DATABASE_URL` (required) - PostgreSQL connection string for the test database

Example `.env` file:
```
TEST_DATABASE_URL=postgres://postgres:postgres@localhost/polos_test
```

## Notes

- The orchestrator HTTP server does NOT need to be running
- These are database-level tests, not API tests
- Make sure to use a dedicated test database (not production)
- Tests will automatically run migrations on the test database
