# Data Format

## Input: XLSX

The app reads Excel files with the following columns (sheet name: `raw` by default, selectable via dropdown):

| Column | Required | Description |
|--------|----------|-------------|
| `contract_id` | No | Project identifier, passed through to output |
| `region` | No | Region name, used in analytics |
| `implementing_office` | No | Office name, passed through |
| `year` | No | Project year, passed through |
| `status` | No | Project status, passed through |
| `latitude` | Yes | Centroid latitude (WGS84, decimal degrees) |
| `longitude` | Yes | Centroid longitude (WGS84, decimal degrees) |
| `actual_start_date` | Paired mode | Project start date (`MM/DD/YY`, `YYYY-MM-DD`, or Excel date) |
| `completion_date` | Standard/Paired | Project completion date (same formats) |

Rows with invalid/missing coordinates are skipped and written to `invalid.geojson`.

## Input: GeoJSON

Alternatively, load a GeoJSON `FeatureCollection` directly. Each feature's `geometry` is used as the search AOI, and `properties` are passed through to the output. Expected property keys match the XLSX columns above (`start_date`, `completion_date`, etc.).

The app auto-detects **paired mode** if features contain both `start_date` and `completion_date`.

## Output: GeoJSON

Each output file is a `FeatureCollection`. Archive features include the original input properties plus:

| Property | Description |
|----------|-------------|
| `classification` | `archive`, `Tasking`, `invalid`, or `error` |
| `planet_id` | Planet scene ID |
| `item_type` | Always `SkySatCollect` |
| `acquired` | ISO-8601 acquisition datetime |
| `cloud_cover` | 0–1 decimal |
| `clear_percent` | Clear pixel percentage |
| `gsd` | Ground sample distance (meters) |
| `satellite_id` | Satellite name |
| `search_window` | `start/end` ISO range used for the search |
| `_buffer` | `start` or `completion` *(paired mode only)* |
