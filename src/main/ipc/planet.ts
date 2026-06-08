import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as archiver from 'archiver'
import { app } from 'electron'

const PLANET_BASE = 'https://api.planet.com/data/v1'
const CONCURRENCY = 4

// ── Types ────────────────────────────────────────────────────────────────────

export type BatchMode = 'standard' | 'paired'

export interface BatchOptions {
  outputDir: string
  mode: BatchMode
  datetimeGte: string | null
  datetimeLte: string | null
  maxCloud: number
  completionBufferMonths: number
  startBufferMonths: number
}

interface BatchStatus {
  running: boolean
  total: number
  processed: number
  archive: number
  tasking: number
  failed: number
  invalid: number
  startedAt: Date | null
  finishedAt: Date | null
  cancelRequested: boolean
}

// ── Module state ─────────────────────────────────────────────────────────────

let _status: BatchStatus = {
  running: false, total: 0, processed: 0,
  archive: 0, tasking: 0, failed: 0, invalid: 0,
  startedAt: null, finishedAt: null, cancelRequested: false
}

let _progressCallback: ((s: object) => void) | null = null

export function registerProgressCallback(cb: (s: object) => void) {
  _progressCallback = cb
}

function _emit() {
  if (!_progressCallback) return
  const now = new Date()
  const elapsedMs = _status.startedAt ? now.getTime() - _status.startedAt.getTime() : 0
  _progressCallback({
    running: _status.running,
    total: _status.total,
    processed: _status.processed,
    archive: _status.archive,
    tasking: _status.tasking,
    failed: _status.failed,
    invalid: _status.invalid,
    elapsed: _formatDuration(elapsedMs),
    finished: !!_status.finishedAt
  })
}

export function getBatchStatus() {
  const now = new Date()
  const elapsedMs = _status.startedAt ? now.getTime() - _status.startedAt.getTime() : 0
  return { ..._status, elapsed: _formatDuration(elapsedMs) }
}

export function cancelBatch() {
  _status.cancelRequested = true
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${m}m ${sec}s`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}

function _dateWindowFrom(dateStr: string, months: number): [string, string] | null {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const end = new Date(d)
  end.setMonth(end.getMonth() + months)
  return [d.toISOString(), end.toISOString()]
}

function _hasNullCoord(coords: unknown): boolean {
  if (coords === null || coords === undefined) return true
  if (Array.isArray(coords)) return coords.some(_hasNullCoord)
  return false
}

// ── Planet API search ────────────────────────────────────────────────────────

const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function _searchPlanet(
  geometry: object,
  gte: string,
  lte: string,
  maxCloud: number,
  apiKey: string
): Promise<object | null | 'error'> {
  const MAX_RETRIES = 4
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await axios.post(
        `${PLANET_BASE}/quick-search`,
        {
          item_types: ['SkySatCollect'],
          filter: {
            type: 'AndFilter',
            config: [
              { type: 'GeometryFilter', field_name: 'geometry', config: geometry },
              { type: 'DateRangeFilter', field_name: 'acquired', config: { gte, lte } },
              { type: 'RangeFilter', field_name: 'cloud_cover', config: { lte: maxCloud / 100 } }
            ]
          }
        },
        { auth: { username: apiKey, password: '' }, timeout: 30000 }
      )
      const items: object[] = resp.data?.features ?? []
      if (!items.length) return null
      // Sort client-side — API sort param is ignored
      items.sort((a: any, b: any) =>
        (a.properties?.cloud_cover ?? 1) - (b.properties?.cloud_cover ?? 1)
      )
      return items[0]
    } catch (err: any) {
      const status = err.response?.status
      if (status === 429) {
        // Rate limited — back off and retry
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] ?? '0', 10)
        const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt + 1) * 1000
        await _sleep(backoff)
        continue
      }
      // Any other error — don't retry
      console.error(`Planet API error (${status ?? 'network'}):`, err.message)
      return 'error'
    }
  }
  // All retries exhausted (still rate limited)
  return 'error'
}

function _archiveProps(srcProps: object, scene: any, window?: [string, string]): object {
  const p = scene.properties ?? {}
  return {
    ...srcProps,
    classification: 'archive',
    planet_id: scene.id ?? '',
    item_type: 'SkySatCollect',
    acquired: p.acquired ?? '',
    cloud_cover: p.cloud_cover ?? null,
    clear_percent: p.clear_percent ?? null,
    gsd: p.gsd ?? null,
    satellite_id: p.satellite_id ?? '',
    ...(window ? { search_window: `${window[0]}/${window[1]}` } : {})
  }
}

// ── Standard batch ───────────────────────────────────────────────────────────

async function _runStandard(features: any[], opts: BatchOptions, apiKey: string, buckets: any) {
  const sem = new Array(CONCURRENCY).fill(null)
  let semIdx = 0

  const tasks = features.map((feat) => async () => {
    if (_status.cancelRequested) return
    const geom = feat.geometry
    const props = feat.properties ?? {}
    const coords = geom?.coordinates

    if (!geom || !coords || _hasNullCoord(coords)) {
      buckets.invalid.push({ ...feat, properties: { ...props, classification: 'invalid' } })
      _status.invalid++; _status.processed++; _emit(); return
    }

    const completionDate = props.completion_date
    let gte: string, lte: string

    if (completionDate) {
      const w = _dateWindowFrom(String(completionDate), opts.completionBufferMonths)
      if (w) { [gte, lte] = w }
      else { gte = opts.datetimeGte!; lte = opts.datetimeLte! }
    } else {
      gte = opts.datetimeGte!; lte = opts.datetimeLte!
    }

    if (!gte || !lte) {
      buckets.invalid.push({ ...feat, properties: { ...props, classification: 'invalid_no_date' } })
      _status.invalid++; _status.processed++; _emit(); return
    }

    const result = await _searchPlanet(geom, gte, lte, opts.maxCloud, apiKey)

    if (result === 'error') {
      buckets.errored.push({ ...feat, properties: { ...props, classification: 'error' } })
      _status.failed++
    } else if (result === null) {
      buckets.tasking.push({ ...feat, properties: { ...props, classification: 'Tasking' } })
      _status.tasking++
    } else {
      const w: [string, string] | undefined = completionDate ? [gte, lte] : undefined
      buckets.archive.push({ ...feat, properties: _archiveProps(props, result, w) })
      _status.archive++
    }
    _status.processed++; _emit()
  })

  await _runConcurrent(tasks)
}

// ── Paired batch ─────────────────────────────────────────────────────────────

async function _runPaired(features: any[], opts: BatchOptions, apiKey: string, buckets: any) {
  const tasks = features.map((feat) => async () => {
    if (_status.cancelRequested) return
    const geom = feat.geometry
    const props = feat.properties ?? {}
    const coords = geom?.coordinates

    if (!geom || !coords || _hasNullCoord(coords)) {
      buckets.invalid.push({ ...feat, properties: { ...props, classification: 'invalid' } })
      _status.invalid++; _status.processed++; _emit(); return
    }

    const startDate = props.start_date
    const completionDate = props.completion_date

    if (!startDate || !completionDate) {
      buckets.invalid.push({ ...feat, properties: { ...props, classification: 'invalid_missing_dates' } })
      _status.invalid++; _status.processed++; _emit(); return
    }

    const startWindow = _dateWindowFrom(String(startDate), opts.startBufferMonths)
    const completionWindow = _dateWindowFrom(String(completionDate), opts.completionBufferMonths)

    if (!startWindow || !completionWindow) {
      buckets.invalid.push({ ...feat, properties: { ...props, classification: 'invalid_bad_dates' } })
      _status.invalid++; _status.processed++; _emit(); return
    }

    const [startResult, completionResult] = await Promise.all([
      _searchPlanet(geom, startWindow[0], startWindow[1], opts.maxCloud, apiKey),
      _searchPlanet(geom, completionWindow[0], completionWindow[1], opts.maxCloud, apiKey)
    ])

    if (startResult === 'error' || completionResult === 'error') {
      buckets.errored.push({ ...feat, properties: { ...props, classification: 'error' } })
      _status.failed++; _status.processed++; _emit(); return
    }

    if (startResult) {
      buckets.startArchive.push({ ...feat, properties: { ..._archiveProps(props, startResult, startWindow), _buffer: 'start' } })
      _status.archive++
    } else {
      buckets.startTasking.push({ ...feat, properties: { ...props, classification: 'Tasking', _buffer: 'start' } })
      _status.tasking++
    }

    if (completionResult) {
      buckets.completionArchive.push({ ...feat, properties: { ..._archiveProps(props, completionResult, completionWindow), _buffer: 'completion' } })
      _status.archive++
    } else {
      buckets.completionTasking.push({ ...feat, properties: { ...props, classification: 'Tasking', _buffer: 'completion' } })
      _status.tasking++
    }

    _status.processed++; _emit()
  })

  await _runConcurrent(tasks)
}

async function _runConcurrent(tasks: (() => Promise<void>)[]) {
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const task = tasks[idx++]
      await task()
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

// ── Output ───────────────────────────────────────────────────────────────────

function _writeGeoJSON(filePath: string, features: object[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ type: 'FeatureCollection', features }, null, 2))
}

// ── Public entry ─────────────────────────────────────────────────────────────

export async function runBatch(geojson: any, opts: BatchOptions, apiKey: string): Promise<object> {
  const features = geojson?.features ?? []

  _status = {
    running: true, total: features.length, processed: 0,
    archive: 0, tasking: 0, failed: 0, invalid: 0,
    startedAt: new Date(), finishedAt: null, cancelRequested: false
  }
  _emit()

  const buckets = {
    archive: [], tasking: [], errored: [], invalid: [],
    startArchive: [], startTasking: [], completionArchive: [], completionTasking: []
  }

  const out = path.join(opts.outputDir, 'output')

  if (opts.mode === 'paired') {
    await _runPaired(features, opts, apiKey, buckets)
    _writeGeoJSON(path.join(out, 'start', 'archive.geojson'), buckets.startArchive)
    _writeGeoJSON(path.join(out, 'start', 'tasking.geojson'), buckets.startTasking)
    _writeGeoJSON(path.join(out, 'completion', 'archive.geojson'), buckets.completionArchive)
    _writeGeoJSON(path.join(out, 'completion', 'tasking.geojson'), buckets.completionTasking)
    _writeGeoJSON(path.join(out, 'invalid.geojson'), buckets.invalid)
    _writeGeoJSON(path.join(out, 'errors.geojson'), buckets.errored)
  } else {
    await _runStandard(features, opts, apiKey, buckets)
    _writeGeoJSON(path.join(out, 'archive.geojson'), buckets.archive)
    _writeGeoJSON(path.join(out, 'tasking.geojson'), buckets.tasking)
    _writeGeoJSON(path.join(out, 'invalid.geojson'), buckets.invalid)
    _writeGeoJSON(path.join(out, 'errors.geojson'), buckets.errored)
  }

  _status.running = false
  _status.finishedAt = new Date()
  _emit()

  const archiveFeatures = opts.mode === 'paired'
    ? [...buckets.startArchive, ...buckets.completionArchive]
    : buckets.archive

  return {
    mode: opts.mode,
    outputDir: opts.outputDir,
    archive: archiveFeatures,
    invalid: buckets.invalid,
    errored: buckets.errored,
    summary: {
      total: features.length,
      archive: archiveFeatures.length,
      tasking: opts.mode === 'paired'
        ? buckets.startTasking.length + buckets.completionTasking.length
        : buckets.tasking.length,
      invalid: buckets.invalid.length,
      errors: buckets.errored.length,
      hitRate: features.length > 0
        ? ((archiveFeatures.length / features.length) * 100).toFixed(1)
        : '0.0'
    }
  }
}

export async function createZip(sourceDir: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath)
    const archive = archiver.default('zip', { zlib: { level: 6 } })
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(sourceDir, false)
    archive.finalize()
  })
}
