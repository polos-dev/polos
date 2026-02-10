# Building and Releasing Polos TypeScript SDK

This document describes how to build, test, and release the `@polos/sdk` npm package.

## Prerequisites

- Node.js 18+ installed
- npm (comes with Node.js)
- Git access to the repository
- npm account with access to the `@polos` scope (for publishing releases)

## Local Development

### Setup

```bash
cd sdk/typescript

# Install dependencies
npm install
```

### Running Tests

```bash
npm test

# Watch mode
npm run test:watch
```

### Code Quality

```bash
# Typecheck
npm run typecheck

# Lint
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

## Building the Package

### Build Locally

```bash
cd sdk/typescript

# Build (creates dist/ with ESM, CJS, and type declarations)
npm run build
```

This will create:
- `dist/index.js` (ESM module)
- `dist/index.cjs` (CommonJS module)
- `dist/index.d.ts` (TypeScript declarations)
- `dist/index.d.cts` (CommonJS TypeScript declarations)

### Verify the Build

```bash
# Dry-run publish to check what would be included
npm publish --dry-run
```

### Test Installation

```bash
# Pack the package locally (creates a .tgz file)
npm pack

# Install in another project to test
cd /path/to/test/project
npm install /path/to/sdk/typescript/polos-sdk-0.1.0.tgz

# Verify import works
node -e "const polos = require('@polos/sdk'); console.log(Object.keys(polos))"
```

## Version Management

The package version is managed statically in `package.json`. Unlike the Python SDK (which uses `hatch-vcs` for dynamic versioning), npm packages get their version directly from `package.json`.

- Version is set in `package.json` under `"version"`
- The CI workflow verifies that the Git tag version matches `package.json` version
- Tag format: `typescript-sdk-v<version>` (e.g., `typescript-sdk-v0.1.0`)

### Updating the Version

Before creating a release tag, update the version in `package.json`:

```bash
cd sdk/typescript

# Update version (e.g., to 0.2.0)
npm version 0.2.0 --no-git-tag-version
```

Or edit `package.json` directly.

## Releasing to npm

### Release Process

The release process is automated via GitHub Actions. To create a release:

#### 1. Ensure Code is Ready

```bash
# Make sure all changes are committed
git status

# Run tests locally
cd sdk/typescript
npm test

# Check code quality
npm run typecheck
npm run lint

# Build and verify
npm run build
npm publish --dry-run
```

#### 2. Update Version in package.json

```bash
cd sdk/typescript
# Update to desired version
npm version 0.1.0 --no-git-tag-version
```

#### 3. Commit and Push Changes

```bash
git add sdk/typescript/package.json
git commit -m "sdk/typescript: Prepare for release v0.1.0"
git push origin main  # or your branch name
```

#### 4. Create and Push Release Tag

```bash
# Create the tag (must match pattern: typescript-sdk-v*)
git tag typescript-sdk-v0.1.0

# Push the tag to trigger the release workflow
git push origin typescript-sdk-v0.1.0
```

#### 5. Monitor the Release

1. Go to your GitHub repository
2. Click the "Actions" tab
3. Find the "Release TypeScript SDK" workflow run
4. The workflow will:
   - Run tests on Node.js 18, 20, 22
   - Run typecheck and lint
   - Build the package
   - Verify tag version matches `package.json`
   - Create a GitHub Release with artifacts
   - Publish to npm

#### 6. Verify the Release

After the workflow completes:

**GitHub Release:**
- Visit: `https://github.com/polos-dev/polos/releases`
- You should see the new release

**npm:**
- Visit: `https://www.npmjs.com/package/@polos/sdk`
- The new version should be listed

**Installation Test:**
```bash
npm install @polos/sdk
node -e "const polos = require('@polos/sdk'); console.log(Object.keys(polos))"
```

### Manual Release (Alternative)

If you need to release manually without GitHub Actions:

```bash
cd sdk/typescript

# 1. Ensure you're on the correct tag
git checkout typescript-sdk-v0.1.0

# 2. Install dependencies and build
npm ci
npm run build

# 3. Verify the build
npm publish --dry-run

# 4. Publish to npm (scoped packages require --access public for first publish)
npm publish --access public
```

You'll need to be logged in to npm (`npm login`) with an account that has publish access to the `@polos` scope.

## Release Notes

The GitHub Actions workflow automatically generates release notes from commits between tags:

- For the first release: All commits up to the tag
- For subsequent releases: Commits since the last `typescript-sdk-v*` tag

You can edit the release notes in the GitHub Release after it's created.

## Troubleshooting

### Version Mismatch Error in CI

**Problem**: The CI workflow fails with "package.json version does not match tag version".

**Solution**:
- Ensure `package.json` version matches the tag (e.g., tag `typescript-sdk-v0.1.0` requires `"version": "0.1.0"` in `package.json`)
- Update `package.json` and push before creating the tag

### npm Publish Fails: 401 Unauthorized

**Problem**: Authentication failed during publish.

**Solution**:
- Verify `NPM_TOKEN` is set in GitHub Secrets
- Check the token hasn't expired or been revoked
- Ensure the token has publish access to the `@polos` scope

### npm Publish Fails: 403 Forbidden

**Problem**: Scoped package requires public access.

**Solution**:
- The workflow uses `--access public` for publishing
- If publishing manually for the first time, use `npm publish --access public`
- Ensure `publishConfig.access` is set to `"public"` in `package.json`

### Build Fails

**Problem**: `tsup` build fails.

**Solution**:
- Run `npm ci` to ensure clean dependencies
- Check `tsup.config.ts` and `tsconfig.build.json` are valid
- Ensure TypeScript compiles cleanly: `npm run typecheck`

### Tests Fail in CI

**Problem**: Tests pass locally but fail in GitHub Actions.

**Solution**:
- Check the test output in the Actions tab
- Ensure all dependencies are listed in `package.json`
- Verify Node.js version compatibility (must work on 18, 20, 22)
- Check for environment-specific issues

## Package Structure

```
sdk/typescript/
├── src/                # Source code
│   ├── index.ts        # Main entry point (exports)
│   ├── *.test.ts       # Test files
│   └── ...             # Implementation files
├── dist/               # Built output (generated)
├── package.json        # Package configuration
├── tsconfig.json       # TypeScript configuration
├── tsconfig.build.json # TypeScript build configuration
├── tsup.config.ts      # tsup bundler configuration
├── eslint.config.js    # ESLint configuration
├── README.md           # Package documentation
├── BUILD.md            # This file
└── .npmrc              # npm registry configuration (for CI)
```

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

Examples:
- `typescript-sdk-v0.1.0` - Initial release
- `typescript-sdk-v0.1.1` - Patch release (bug fixes)
- `typescript-sdk-v0.2.0` - Minor release (new features)
- `typescript-sdk-v1.0.0` - Major release (breaking changes)

## Related Documentation

- [Package README](./README.md) - User-facing documentation
- [GitHub Actions Workflow](../../.github/workflows/release-typescript-sdk.yml) - Automated release workflow
- [npm Package](https://www.npmjs.com/package/@polos/sdk) - Published package page
