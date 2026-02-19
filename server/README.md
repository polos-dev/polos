# Polos CLI

A single binary that makes it easy to run Polos orchestrator locally.

## Installation

Download the binary for your platform from [GitHub Releases](https://github.com/polos-dev/polos/releases):

- `polos-darwin-arm64` (macOS Apple Silicon)
- `polos-darwin-x86_64` (macOS Intel)
- `polos-linux-arm64` (Linux ARM)
- `polos-linux-x86_64` (Linux x86_64)

Make it executable and move it to your PATH:

```bash
chmod +x polos-*
sudo mv polos-* /usr/local/bin/polos
```

## Prerequisites

- PostgreSQL installed and running
- Default connection: `postgres://postgres:postgres@localhost/polos`

You can override the database URL with the `DATABASE_URL` environment variable:

```bash
export DATABASE_URL="postgres://user:password@localhost/polos"
polos server start
```

## Usage

### Start the server

```bash
polos server start
```

This will:
1. Check if the server is initialized (first run only)
2. If not initialized:
   - Create the `polos` database (if it doesn't exist)
   - Run database migrations
   - Create a default user (`user@local`)
   - Create a default project (`default`)
   - Generate an API key
3. Start the orchestrator on port 8080
4. Start the UI server on port 5173

The API key and project ID will be displayed when the server starts.

### Check status

```bash
polos server status
```

### Stop the server

Press `Ctrl+C` in the terminal where the server is running, or:

```bash
polos server stop
```

### Reset (delete all data)

```bash
polos server reset
```

**Warning**: This will delete all configuration and data. You'll need to run `polos server start` again to re-initialize.

## Configuration

Configuration is stored in `~/.polos/config.toml`. You can edit this file to change ports or other settings.

## Development

To build from source:

Fork the github repo https://github.com/polos-dev/polos.git

Clone the forked repo

```
git clone https://github.com/<your-fork>/polos.git
```

```bash
# Build UI first
cd ui
npm install
VITE_POLOS_LOCAL_MODE=true npm run build

# Build orchestrator
cd ../orchestrator
cargo build --release

# Build server
cd ../server
cargo build --release
```

The CLI binary will be at `target/release/polos`.

## Architecture

The `polos` binary:
- Embeds the orchestrator binary
- Serves the UI static files (from `ui/dist`)
- Manages both processes
- Handles initialization and database setup

## Troubleshooting

### Database connection errors

Make sure PostgreSQL is running:

```bash
# macOS (Homebrew)
brew services start postgresql

# Linux (systemd)
sudo systemctl start postgresql
```

### Port already in use

If ports 8080 or 5173 are already in use, you can:
1. Stop the conflicting service
2. Edit `~/.polos/config.toml` to change ports
3. Restart the server

### UI not found

Make sure the UI is built:

```bash
cd ui
npm run build
```

Then rebuild the server:

```bash
cd server
cargo build --release
```
