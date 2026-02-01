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
INSTALL_DIR="${POLOS_INSTALL_DIR:-/usr/local/bin}"

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

# Get latest release version from GitHub
get_latest_version() {
    local api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
    
    if [ "$HAS_JQ" = true ]; then
        download_file "$api_url" | jq -r '.tag_name' | sed 's/^v//'
    else
        # Fallback: extract version from tag_name in JSON
        local response
        response=$(download_file "$api_url")
        # Simple extraction using grep/sed (fragile but works for basic cases)
        echo "$response" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/'
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
    local platform version binary_name checksum_file checksum_url binary_url
    
    platform=$(detect_platform)
    binary_name="polos-server-${platform}"
    checksum_file="checksums-polos-server-${platform}.txt"
    
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
        # Remove 'v' prefix if present
        version="${version#v}"
        echo "Installing version: v${version}"
    fi
    
    # Create download directory
    mkdir -p "$DOWNLOAD_DIR"
    
    # Construct URLs
    local base_url="https://github.com/${GITHUB_REPO}/releases/download/v${version}"
    binary_url="${base_url}/${binary_name}"
    checksum_url="${base_url}/${checksum_file}"
    
    echo ""
    echo "Downloading binary..."
    local binary_path="${DOWNLOAD_DIR}/${binary_name}"
    if ! download_file "$binary_url" "$binary_path"; then
        echo "Error: Failed to download binary from:" >&2
        echo "  $binary_url" >&2
        echo ""
        echo "This version may not be available for your platform." >&2
        echo "Available releases: https://github.com/${GITHUB_REPO}/releases" >&2
        exit 1
    fi
    
    echo "Downloading checksum..."
    local checksum_path="${DOWNLOAD_DIR}/${checksum_file}"
    if ! download_file "$checksum_url" "$checksum_path"; then
        echo "Warning: Checksum file not found, skipping verification" >&2
        echo "  URL: $checksum_url" >&2
    else
        # Extract checksum from checksum file
        local expected_checksum
        expected_checksum=$(grep "$binary_name" "$checksum_path" | cut -d' ' -f1)
        
        if [ -n "$expected_checksum" ]; then
            echo "Verifying checksum..."
            if ! verify_checksum "$binary_path" "$expected_checksum"; then
                rm -f "$binary_path" "$checksum_path"
                exit 1
            fi
            echo "✓ Checksum verified"
        else
            echo "Warning: Could not extract checksum from checksum file" >&2
        fi
    fi
    
    # Make binary executable
    chmod +x "$binary_path"
    
    # Determine install location
    if [ ! -w "$INSTALL_DIR" ]; then
        # Try user-local bin directory
        if [ -d "$HOME/.local/bin" ]; then
            INSTALL_DIR="$HOME/.local/bin"
        elif [ -d "$HOME/bin" ]; then
            INSTALL_DIR="$HOME/bin"
        else
            # Need sudo for system-wide installation
            echo ""
            echo "Installing to $INSTALL_DIR requires administrator privileges."
            echo "Please enter your password when prompted."
            SUDO_CMD="sudo"
        fi
    else
        SUDO_CMD=""
    fi
    
    # Install binary
    echo ""
    echo "Installing polos-server to ${INSTALL_DIR}..."
    $SUDO_CMD mkdir -p "$INSTALL_DIR"
    $SUDO_CMD cp "$binary_path" "${INSTALL_DIR}/polos-server"
    $SUDO_CMD chmod +x "${INSTALL_DIR}/polos-server"
    
    # Clean up
    rm -f "$binary_path" "$checksum_path"
    rmdir "$DOWNLOAD_DIR" 2>/dev/null || true
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ Installation complete!"
    echo ""
    echo "Polos Server has been installed to: ${INSTALL_DIR}/polos-server"
    echo ""
    
    # Check if polos-server is in PATH
    if command -v polos-server >/dev/null 2>&1; then
        echo "You can now run: polos-server start"
    else
        echo "Note: ${INSTALL_DIR} may not be in your PATH."
        echo "Add it to your PATH or run: ${INSTALL_DIR}/polos-server start"
        echo ""
        if [ "$INSTALL_DIR" = "$HOME/.local/bin" ]; then
            echo "To add ~/.local/bin to your PATH, add this to your shell config:"
            echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        fi
    fi
    echo ""
}

# Run main function
main "$@"
