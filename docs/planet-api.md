# Planet API Notes

Key findings from working with the Planet Data API for SkySat imagery.

## Authentication

Basic auth — API key as username, empty password:

```
Authorization: Basic base64(apiKey:)
```

## Search Endpoint

`POST https://api.planet.com/data/v1/quick-search`

Item type used: `SkySatCollect`

### Filter structure

```json
{
  "item_types": ["SkySatCollect"],
  "filter": {
    "type": "AndFilter",
    "config": [
      { "type": "GeometryFilter", "field_name": "geometry", "config": <geojson_geometry> },
      { "type": "DateRangeFilter", "field_name": "acquired", "config": { "gte": "...", "lte": "..." } },
      { "type": "RangeFilter", "field_name": "cloud_cover", "config": { "lte": 0.05 } }
    ]
  }
}
```

## Known Quirks

- **`cloud_cover` is 0–1 decimal**, not 0–100 percentage. Divide user-facing % by 100 before sending.
- **API-side sorting is ignored.** The `_order` sort parameter has no effect. Always sort client-side by `cloud_cover` ascending after fetching.
- **Rate limiting (HTTP 429).** The API rate-limits aggressively under concurrent load. The batch runner retries on 429 with exponential backoff (up to 4 attempts). Concurrency is set to 4 to stay within limits — in paired mode this means 8 simultaneous requests max.
- **Results are paginated.** The quick-search response includes `_links._next` for pagination. For our use case (finding the single best image per centroid), the first page is sufficient after sorting client-side.

## Batch Modes

### Standard
One query per centroid. Uses the `completion_date` window (±`completionBufferMonths`). Falls back to the global date range for features without a `completion_date`.

### Paired
Two concurrent queries per centroid — one for the `start_date` window and one for the `completion_date` window. Results are tagged with `_buffer: "start"` or `_buffer: "completion"` and shown in separate analytics columns.

## Concurrency

`CONCURRENCY = 4` — four features processed in parallel. In paired mode each feature fires two requests, so peak load is 8 simultaneous API calls. Increasing this beyond 4 reliably triggers 429s.
