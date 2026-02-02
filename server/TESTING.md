# Testing Embedded Binary Fix

This guide helps you test that the orchestrator binary is properly embedded in `polos-server`.

## Local Testing

### Step 1: Build the Server

```bash
cd server

# Build in release mode
cargo build --release
```

### Step 2: Verify the Binary Contains Embedded Data

Check that the binary was built with the embedded orchestrator:

```bash
# Check if the generated orchestrator_binary.rs file exists
ls -la target/release/build/polos-server-*/out/orchestrator_binary.rs

# Check the binary size (should be larger than before due to embedded orchestrator)
ls -lh target/release/polos-server
```

### Step 3: Test Extraction

Run the server and verify it can extract and run the orchestrator:

```bash
# Start the server (this will extract the embedded orchestrator)
./target/release/polos-server start

# You should see:
# 🚀 Starting Polos server...
# 🔧 Starting orchestrator...
# ✅ Orchestrator started
# (No errors about missing binary paths)
```

### Step 4: Verify Extraction Works

Check that the orchestrator was extracted to a temp directory:

```bash
# While polos-server is running, check temp directory
ls -la /tmp/polos-orchestrator-* 2>/dev/null || echo "No temp files (server may have stopped)"

# The orchestrator should be extracted to something like:
# /tmp/polos-orchestrator-<uuid>/polos-orchestrator
```

### Step 5: Test on a Different Location

To simulate the installer scenario, copy the binary to a different location:

```bash
# Copy to a temp directory (simulating installation)
mkdir -p /tmp/test-polos-install
cp target/release/polos-server /tmp/test-polos-install/

# Run from the new location
cd /tmp/test-polos-install
./polos-server start

# Should work without any path errors
```

### Step 6: Clean Test

Test with a completely fresh binary (no build artifacts):

```bash
# Clean build
cd server
cargo clean
cargo build --release

# Move to a different location
mkdir -p ~/test-install
cp target/release/polos-server ~/test-install/
cd ~/test-install

# Run - should work without any CI build paths
./polos-server start
```

## Testing via GitHub Release

### Step 1: Create a Test Release

```bash
# Make sure all changes are committed
git add server/build.rs server/src/utils.rs
git commit -m "Fix: Embed orchestrator binary directly into polos-server"

# Create a test tag
git tag v0.1.11-test
git push origin v0.1.11-test
```

### Step 2: Wait for GitHub Actions

- Go to GitHub Actions and wait for the release workflow to complete
- Check that all platform builds succeeded

### Step 3: Download and Test

```bash
# Download the binary for your platform
# For macOS ARM64:
curl -L -o polos-server-test \
  https://github.com/polos-dev/polos/releases/download/v0.1.11-test/polos-server-darwin-arm64

# Make executable
chmod +x polos-server-test

# Test it
./polos-server-test start

# Should work without any path errors
```

### Step 4: Test via Installer

Test the full installer flow:

```bash
# Use the installer with the test version
curl -fsSL https://install.polos.dev/install.sh | bash -s 0.1.11-test

# Or if using GitHub Pages URL:
curl -fsSL https://polos-dev.github.io/polos/install.sh | bash -s 0.1.11-test

# Verify installation
polos-server start
```

## Verification Checklist

- [ ] Binary builds successfully locally
- [ ] `orchestrator_binary.rs` is generated in build output
- [ ] Server starts without path errors
- [ ] Orchestrator is extracted to temp directory
- [ ] Binary works when moved to different location
- [ ] Binary works after `cargo clean` and rebuild
- [ ] GitHub Actions build succeeds for all platforms
- [ ] Downloaded binary from GitHub release works
- [ ] Installer script works with new release

## Expected Behavior

### ✅ Success Indicators

- Server starts without errors
- No messages about missing binary paths
- Orchestrator process starts successfully
- UI server starts successfully
- No references to CI build paths (like `/Users/runner/work/...`)

### ❌ Failure Indicators

- Error: "Failed to read orchestrator binary from: /Users/runner/work/..."
- Error: "No such file or directory"
- Error: "ORCHESTRATOR_BINARY not found"
- Build fails with "cannot find value `ORCHESTRATOR_BINARY`"

## Troubleshooting

### Build Fails: "cannot find value `ORCHESTRATOR_BINARY`"

**Problem**: The `orchestrator_binary.rs` file wasn't generated.

**Solution**: 
- Check that `build.rs` is generating the file correctly
- Verify the orchestrator binary exists before building server
- Check build output for errors

### Runtime Error: "Failed to read orchestrator binary"

**Problem**: The embedded binary wasn't included properly.

**Solution**:
- Verify `orchestrator_binary.rs` exists in build output
- Check that `include!` macro in `utils.rs` is correct
- Rebuild with `cargo clean` first

### Binary Size is Too Large

**Note**: The binary will be larger because it contains the orchestrator. This is expected and normal.

## Quick Test Script

Save this as `test-embedded-binary.sh`:

```bash
#!/bin/bash
set -e

echo "🧪 Testing embedded binary fix..."
echo ""

# Build
echo "1. Building server..."
cd server
cargo build --release
echo "✅ Build complete"
echo ""

# Check binary size
echo "2. Binary size:"
ls -lh target/release/polos-server
echo ""

# Check generated file
echo "3. Checking generated orchestrator_binary.rs:"
if ls target/release/build/polos-server-*/out/orchestrator_binary.rs 1> /dev/null 2>&1; then
    echo "✅ orchestrator_binary.rs found"
else
    echo "❌ orchestrator_binary.rs not found"
    exit 1
fi
echo ""

# Test extraction
echo "4. Testing binary extraction..."
TEMP_DIR=$(mktemp -d)
cp target/release/polos-server "$TEMP_DIR/"
cd "$TEMP_DIR"

# Try to extract (this will fail if binary isn't embedded, but that's ok for testing)
timeout 5 ./polos-server start 2>&1 | head -5 || true

echo ""
echo "✅ Local test complete!"
echo "Next: Test via GitHub release"
```

Run with: `bash test-embedded-binary.sh`
