# PlanetExtract

Desktop app for searching Planet SkySat archive imagery against DPWH project centroids. Built with Electron + React + TypeScript.

## Features

- **Drag-and-drop or browse** — load XLSX or GeoJSON files directly
- **Two batch modes**
  - **Standard** — one query per centroid using the `completion_date` window
  - **Paired** — two queries per centroid (start phase + completion phase), results shown side-by-side in analytics
- **Live batch progress** — real-time stats as the batch runs
- **Results tab** — archive hits table with cloud cover, acquired date, satellite, and phase
- **Analytics tab** — cloud cover distribution, hits by region, satellites used; split by phase in paired mode
- **Per-file GeoJSON download** — save archive, tasking, invalid, or errors individually
- **ZIP download** — bundle the full output folder into a ZIP
- **Settings** — API key stored locally, testable in-app

## Requirements

- Node.js 18+
- A [Planet account](https://www.planet.com/) with Data API access

## Development

```bash
npm install
npm run dev
```

## Build (Windows)

```bash
npm run build:win
```

Produces a Windows installer under `dist/`. See [docs/build.md](docs/build.md) for the GitHub Actions workflow.

## Usage

1. Open the app and click the **settings gear** (top-right) to enter your Planet API key
2. Drop an XLSX or GeoJSON file onto the drop zone (or click to browse)
   - XLSX must have a sheet with columns: `contract_id`, `region`, `latitude`, `longitude`, `actual_start_date`, `completion_date`
3. Choose a mode and set buffer months / cloud cover threshold
4. Click **Run Batch**
5. When complete, use the **Results** tab to download individual GeoJSON files or **Download Results** to get a full ZIP

## Project Structure

```
src/
├── main/
│   ├── index.ts          — IPC handlers, file dialogs, batch entry point
│   └── ipc/
│       ├── planet.ts     — Planet REST API client + concurrent batch runner
│       └── settings.ts   — API key persistence
├── preload/
│   ├── index.ts          — contextBridge (window.planet.*)
│   └── index.d.ts        — TypeScript types for renderer
└── renderer/src/
    ├── App.tsx
    ├── globalConfig.ts   — Zustand store
    └── components/
        ├── Header.tsx
        ├── LeftPanel.tsx      — drop zone, filters, run button
        ├── RightPanel.tsx     — stats, progress bar, tabs
        ├── ResultsTable.tsx   — summary + archive table + GeoJSON downloads
        ├── Analytics.tsx      — paired start/completion analytics
        └── SettingsModal.tsx
```

## Output Files

After a batch run, results are saved to the app's userData directory under `outputs/batch_<timestamp>/output/`:

| File | Contents |
|------|----------|
| `archive.geojson` | Features with a matching SkySat image |
| `tasking.geojson` | Features with no image in the search window |
| `invalid.geojson` | Features skipped due to bad coordinates or missing dates |
| `errors.geojson` | Features that failed due to API errors |
| `start/archive.geojson` | *(paired mode)* Start phase archive hits |
| `completion/archive.geojson` | *(paired mode)* Completion phase archive hits |
