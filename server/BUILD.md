# Building and Releasing Polos CLI

## Local Build (for testing)

### Prerequisites
- Rust toolchain installed
- Node.js and npm installed
- PostgreSQL running (for testing)

### Build Steps

**Note:** The build process is automated. The `build.rs` script will automatically:
- Build the orchestrator if needed
- Build the UI with `VITE_POLOS_LOCAL_MODE=true` if the `ui/dist` directory doesn't exist
- Embed both into the final `polos` binary

1. **Build the server** (this will handle orchestrator and UI automatically):
   ```bash
   cd server
   cargo build --release
   ```

   The binary will be at: `server/target/release/polos` (or `server/target/release/polos.exe` on Windows)

**Optional - Manual Build Steps:**

If you want to build components separately:

1. **Build the UI** (with local mode enabled):
   ```bash
   cd ui
   npm install
   VITE_POLOS_LOCAL_MODE=true npm run build
   cd ..
   ```

2. **Build the orchestrator**:
   ```bash
   cd orchestrator
   cargo build --release
   cd ..
   ```

3. **Build the server**:
   ```bash
   cd server
   cargo build --release
   ```

4. **Test locally**:
   ```bash
   ./server/target/release/polos server start
   ```

## Creating a GitHub Release

The GitHub Actions workflow automatically builds binaries for all platforms when you push a version tag.

### Steps to Create a Release

1. **Ensure all changes are committed**:
   ```bash
   git add .
   git commit -m "Your commit message"
   git push origin main  # or your branch name
   ```

2. **Create and push a version tag**:
   ```bash
   # Create an annotated tag (recommended)
   git tag -a v1.0.0 -m "Release v1.0.0"
   
   # Or create a lightweight tag
   git tag v1.0.0
   
   # Push the tag to trigger the workflow
   git push origin v1.0.0
   ```

   The tag name must start with `v` followed by a version number (e.g., `v1.0.0`, `v0.1.0`, `v2.3.4`).

3. **Monitor the GitHub Actions workflow**:
   - Go to your repository on GitHub
   - Click on "Actions" tab
   - You should see a workflow run called "Release" triggered by your tag push
   - Wait for all 4 platform builds to complete (this may take 10-20 minutes)

4. **Verify the release**:
   - Once the workflow completes, go to "Releases" in your GitHub repository
   - You should see a new release with the tag name
   - The release will contain 4 binaries:
     - `polos-darwin-arm64`
     - `polos-darwin-x86_64`
     - `polos-linux-arm64`
     - `polos-linux-x86_64`
   - Each binary will have a corresponding `checksums.txt` file

### Version Numbering

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR** version (e.g., `v2.0.0`): Breaking changes
- **MINOR** version (e.g., `v1.1.0`): New features, backward compatible
- **PATCH** version (e.g., `v1.0.1`): Bug fixes, backward compatible

Examples:
- First release: `v1.0.0`
- Bug fix: `v1.0.1`
- New feature: `v1.1.0`
- Breaking change: `v2.0.0`

### Troubleshooting

#### Workflow fails to build
- Check the Actions tab for error messages
- Common issues:
  - UI build fails: Make sure `ui/package.json` and dependencies are correct. The UI is built with `VITE_POLOS_LOCAL_MODE=true` automatically.
  - Rust build fails: Check for compilation errors
  - Missing migrations: Ensure `orchestrator/migrations/` directory exists

#### Release not created
- Make sure the tag name starts with `v` (e.g., `v1.0.0`, not `1.0.0`)
- Check that the workflow completed successfully
- Verify you have write permissions to the repository

#### Binaries missing from release
- Check the "Create Release" job logs
- Ensure all 4 build jobs completed successfully
- Check artifact upload/download steps

### Manual Release (if needed)

If you need to create a release manually without using the workflow:

1. Build binaries for each platform locally or using CI
2. Go to GitHub → Releases → "Draft a new release"
3. Choose or create a tag
4. Upload the binaries manually
5. Add release notes
6. Publish the release

However, the automated workflow is recommended as it ensures consistent builds across all platforms.
