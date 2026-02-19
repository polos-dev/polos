#!/bin/bash

set -e

# Parse command line arguments
TARGET="${1:-latest}"  # Default to latest if not provided

# Validate target if provided
if [[ -n "$TARGET" ]] && [[ ! "$TARGET" =~ ^(stable|latest|[0-9]+\.[0-9]+\.[0-9]+(-[^[:space:]]+)?)$ ]]; then
    echo "Usage: $0 [stable|latest|VERSION]" >&2
    echo "  stable  - Install the latest stable release" >&2
    echo "  latest  - Install the latest release (default)" >&2
    echo "  VERSION - Install a specific version (e.g., 0.1.10)" >&2
    exit 1
fi

GITHUB_REPO="polos-dev/polos"
DOWNLOAD_DIR="${TMPDIR:-/tmp}/polos-install"
POLOS_HOME="${HOME}/.polos"

# Check for required dependencies
DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    echo "Error: Either curl or wget is required but neither is installed" >&2
    exit 1
fi

# Check if jq is available (optional, for better JSON parsing)
HAS_JQ=false
if command -v jq >/dev/null 2>&1; then
    HAS_JQ=true
fi

# Download function that works with both curl and wget
download_file() {
    local url="$1"
    local output="$2"

    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then
            curl -fsSL -o "$output" "$url"
        else
            curl -fsSL "$url"
        fi
    elif [ "$DOWNLOADER" = "wget" ]; then
        if [ -n "$output" ]; then
            wget -q -O "$output" "$url"
        else
            wget -q -O - "$url"
        fi
    else
        return 1
    fi
}

# Get latest server release version from GitHub
get_latest_version() {
    local api_url="https://api.github.com/repos/${GITHUB_REPO}/releases"

    if [ "$HAS_JQ" = true ]; then
        download_file "$api_url" | jq -r '[.[] | select(.tag_name | test("^v[0-9]"))][0].tag_name' | sed 's/^v//'
    else
        local response
        response=$(download_file "$api_url")
        echo "$response" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"v[0-9][^"]*"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/'
    fi
}

# Detect platform
detect_platform() {
    local os arch platform

    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux) os="linux" ;;
        *) echo "Error: Unsupported operating system: $(uname -s)" >&2; exit 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x86_64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) echo "Error: Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac

    platform="${os}-${arch}"
    echo "$platform"
}

# Add directory to PATH in shell config
add_to_path() {
    local dir="$1"
    local shell_config=""
    local path_line="export PATH=\"${dir}:\$PATH\""

    # Determine shell config file
    case "$SHELL" in
        */zsh)
            shell_config="$HOME/.zshrc"
            ;;
        */bash)
            if [ -f "$HOME/.bash_profile" ]; then
                shell_config="$HOME/.bash_profile"
            else
                shell_config="$HOME/.bashrc"
            fi
            ;;
        *)
            shell_config="$HOME/.profile"
            ;;
    esac

    # Check if already in config
    if [ -f "$shell_config" ] && grep -q "$dir" "$shell_config" 2>/dev/null; then
        echo "PATH already configured in $shell_config"
        return
    fi

    # Add to config
    echo "" >> "$shell_config"
    echo "# Added by Polos installer" >> "$shell_config"
    echo "$path_line" >> "$shell_config"

    echo "Added ${dir} to PATH in $shell_config"
}

# Verify checksum
verify_checksum() {
    local file="$1"
    local expected="$2"
    local actual

    if [ "$(uname -s)" = "Darwin" ]; then
        actual=$(shasum -a 256 "$file" | cut -d' ' -f1)
    else
        actual=$(sha256sum "$file" | cut -d' ' -f1)
    fi

    if [ "$actual" != "$expected" ]; then
        echo "Error: Checksum verification failed" >&2
        echo "  Expected: $expected" >&2
        echo "  Actual:   $actual" >&2
        return 1
    fi
    return 0
}

# Main installation
main() {
    local platform version tarball_name checksum_file

    platform=$(detect_platform)
    tarball_name="polos-${platform}.tar.gz"
    checksum_file="checksums-${tarball_name}.txt"

    echo "🚀 Polos Server Installer"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Platform detected: $platform"

    # Determine version
    if [ "$TARGET" = "latest" ] || [ "$TARGET" = "stable" ]; then
        echo "Fetching latest release version..."
        version=$(get_latest_version)
        if [ -z "$version" ]; then
            echo "Error: Failed to determine latest version" >&2
            exit 1
        fi
        echo "Latest version: v${version}"
    else
        version="$TARGET"
        version="${version#v}"
        echo "Installing version: v${version}"
    fi

    # Create directories
    mkdir -p "$DOWNLOAD_DIR"
    mkdir -p "$POLOS_HOME/bin"
    mkdir -p "$POLOS_HOME/ui"

    # Construct URLs
    local base_url="https://github.com/${GITHUB_REPO}/releases/download/v${version}"
    local tarball_url="${base_url}/${tarball_name}"
    local checksum_url="${base_url}/${checksum_file}"

    echo ""
    echo "Downloading ${tarball_name}..."
    local tarball_path="${DOWNLOAD_DIR}/${tarball_name}"
    if ! download_file "$tarball_url" "$tarball_path"; then
        echo "Error: Failed to download tarball from:" >&2
        echo "  $tarball_url" >&2
        echo ""
        echo "This version may not be available for your platform." >&2
        echo "Available releases: https://github.com/${GITHUB_REPO}/releases" >&2
        exit 1
    fi

    echo "Downloading checksum..."
    local checksum_path="${DOWNLOAD_DIR}/${checksum_file}"
    if ! download_file "$checksum_url" "$checksum_path"; then
        echo "Warning: Checksum file not found, skipping verification" >&2
    else
        local expected_checksum
        expected_checksum=$(grep "$tarball_name" "$checksum_path" | cut -d' ' -f1)

        if [ -n "$expected_checksum" ]; then
            echo "Verifying checksum..."
            if ! verify_checksum "$tarball_path" "$expected_checksum"; then
                rm -f "$tarball_path" "$checksum_path"
                exit 1
            fi
            echo "✓ Checksum verified"
        else
            echo "Warning: Could not extract checksum from checksum file" >&2
        fi
    fi

    # Extract tarball to ~/.polos
    echo ""
    echo "Installing to ${POLOS_HOME}..."
    tar -xzf "$tarball_path" -C "$POLOS_HOME"

    # Make binaries executable
    chmod +x "$POLOS_HOME/bin/polos"
    chmod +x "$POLOS_HOME/bin/polos-orchestrator"

    # Clean up
    rm -f "$tarball_path" "$checksum_path"
    rmdir "$DOWNLOAD_DIR" 2>/dev/null || true

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ Installation complete!"
    echo ""
    echo "Polos has been installed to: ${POLOS_HOME}"
    echo "  - CLI:          ${POLOS_HOME}/bin/polos"
    echo "  - Orchestrator: ${POLOS_HOME}/bin/polos-orchestrator"
    echo "  - UI:           ${POLOS_HOME}/ui/"
    echo ""

    # Check if polos is in PATH
    if ! command -v polos >/dev/null 2>&1; then
        add_to_path "$POLOS_HOME/bin"
        echo ""
        echo "Restart your terminal or run: source ~/.zshrc"
        echo ""
    fi

    echo "Get started by scaffolding a new project:"
    echo ""
    echo "  TypeScript:  npx create-polos"
    echo "  Python:      pipx run create-polos"
    echo ""
}

# Run main function
main "$@"
