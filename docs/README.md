# Installer Documentation

This directory contains the installer script and web page for the Polos CLI.

## Files

- `install.sh` - The main installer script that users can run via `curl | bash`
- `index.html` - Web page with installation instructions

## GitHub Pages Setup

These files are served via GitHub Pages when enabled:

1. Go to repository Settings → Pages
2. Source: Deploy from a branch
3. Branch: `main` (or `gh-pages`), folder: `/install`
4. Save

The installer will be available at:
- `https://polos-dev.github.io/polos/install.sh`
- Or with custom domain: `https://install.polos.dev/install.sh`

## Custom Domain Setup

To use `https://install.polos.dev`:

1. Point DNS to GitHub Pages:
   - Add CNAME record: `install.polos.dev` → `polos-dev.github.io`
   - Or use A records (see GitHub Pages documentation)

2. Configure in GitHub:
   - Repository Settings → Pages → Custom domain
   - Enter: `install.polos.dev`
   - Enable "Enforce HTTPS"

## Usage

Users can install with:

```bash
curl -fsSL https://install.polos.dev/install.sh | bash
```

Or visit `https://install.polos.dev` for the web interface.
