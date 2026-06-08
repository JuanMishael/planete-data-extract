# Building for Windows

## Local build (requires Windows)

```bash
npm run build:win
```

Output: `dist/planet-data-fetcher-<version>-setup.exe`

## GitHub Actions (build from macOS)

The workflow at `.github/workflows/build-windows.yml` builds on a `windows-latest` runner automatically.

### On every push to `main`

The build runs and the output ZIP is uploaded as a **GitHub Actions artifact** (retained 30 days).

**Where to find it:**
1. Go to your repo on GitHub
2. Click **Actions** → select the latest run
3. Scroll to **Artifacts** at the bottom → download `PlanetExtract-windows`

### Creating a Release

Push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This triggers the same build and automatically creates a **GitHub Release** with `PlanetExtract-windows.zip` attached. Users download directly from the release page.

## What the user receives

A ZIP containing the app folder. No Python, no Node.js, no installs required — just unzip and double-click `PlanetExtract.exe`.

The only setup step for the end user is entering their Planet API key via the settings gear in the app.
