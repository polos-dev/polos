#!/bin/bash
#
# Build all Polos components from source and install to ~/.polos
# for local development and testing.
#
# Prerequisites:
#   - Rust (cargo)
#   - Node.js (npm)
#   - PostgreSQL running locally
#
# Usage:
#   ./scripts/dev-setup.sh          # Build everything
#   ./scripts/dev-setup.sh --skip-ui # Skip UI build
#   ./scripts/dev-setup.sh --release # Build in release mode
#

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POLOS_HOME="${HOME}/.polos"
CARGO_PROFILE="debug"
SKIP_UI=false

for arg in "$@"; do
    case "$arg" in
        --release) CARGO_PROFILE="release" ;;
        --skip-ui) SKIP_UI=true ;;
        --help)
            echo "Usage: $0 [--release] [--skip-ui]"
            echo "  --release   Build Rust binaries in release mode"
            echo "  --skip-ui   Skip the UI build"
            exit 0
            ;;
    esac
done

CARGO_FLAGS=""
if [ "$CARGO_PROFILE" = "release" ]; then
    CARGO_FLAGS="--release"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Polos dev setup — building from source"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Repo:    $REPO_ROOT"
echo "  Install: $POLOS_HOME"
echo "  Profile: $CARGO_PROFILE"
echo ""

mkdir -p "$POLOS_HOME/bin"

# ── 1. Orchestrator ──────────────────────────────────────

echo "[1/5] Building orchestrator..."
(cd "$REPO_ROOT/orchestrator" && cargo build $CARGO_FLAGS 2>&1)
cp "$REPO_ROOT/orchestrator/target/$CARGO_PROFILE/polos-orchestrator" "$POLOS_HOME/bin/polos-orchestrator"
chmod +x "$POLOS_HOME/bin/polos-orchestrator"
echo "  -> $POLOS_HOME/bin/polos-orchestrator"

# ── 2. CLI (polos) ───────────────────────────────────────

echo "[2/5] Building CLI..."
(cd "$REPO_ROOT/server" && cargo build $CARGO_FLAGS 2>&1)
cp "$REPO_ROOT/server/target/$CARGO_PROFILE/polos" "$POLOS_HOME/bin/polos"
chmod +x "$POLOS_HOME/bin/polos"
echo "  -> $POLOS_HOME/bin/polos"

# ── 3. UI ────────────────────────────────────────────────

if [ "$SKIP_UI" = true ]; then
    echo "[3/5] Skipping UI build (--skip-ui)"
else
    echo "[3/5] Building UI..."
    (cd "$REPO_ROOT/ui" && npm install --silent && VITE_POLOS_LOCAL_MODE=true npm run build 2>&1)
    rm -rf "$POLOS_HOME/ui"
    cp -r "$REPO_ROOT/ui/dist" "$POLOS_HOME/ui"
    echo "  -> $POLOS_HOME/ui/"
fi

# ── 4. TypeScript SDK ────────────────────────────────────

echo "[4/5] Building & linking TypeScript SDK..."
(cd "$REPO_ROOT/sdk/typescript" && npm install --silent && npm run build 2>&1)
(cd "$REPO_ROOT/sdk/typescript" && npm link 2>&1)
echo "  -> npm link @polos/sdk"

# ── 5. Python SDK ────────────────────────────────────────

echo "[5/5] Installing Python SDK in editable mode..."
if command -v uv >/dev/null 2>&1; then
    (cd "$REPO_ROOT/sdk/python" && uv pip install -e ".[dev]" 2>&1)
else
    (cd "$REPO_ROOT/sdk/python" && pip install -e ".[dev]" 2>&1)
fi
echo "  -> pip install -e sdk/python"

# ── Done ─────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Done! Installed to $POLOS_HOME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "$POLOS_HOME/bin"; then
    echo "Add to your PATH:"
    echo "  export PATH=\"$POLOS_HOME/bin:\$PATH\""
    echo ""
fi

echo "Quick test:"
echo "  polos server start        # start orchestrator + UI"
echo "  polos server status       # verify everything is running"
echo ""
echo "Scaffold a test project (TypeScript):"
echo "  cd /tmp"
echo "  npx tsx $REPO_ROOT/create-polos-ts/src/index.ts"
echo "  cd <project-name>"
echo "  npm link @polos/sdk       # use local SDK"
echo "  cp .env.example .env      # add API keys"
echo "  polos dev                  # start dev mode"
echo ""
echo "Scaffold a test project (Python):"
echo "  cd /tmp"
echo "  uvx --from $REPO_ROOT/create-polos-py create-polos"
echo "  cd <project-name>"
echo "  uv pip install -e $REPO_ROOT/sdk/python  # use local SDK"
echo "  cp .env.example .env      # add API keys"
echo "  polos dev                  # start dev mode"
echo ""
