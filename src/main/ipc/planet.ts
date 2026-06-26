import * as fs from 'fs'
import * as path from 'path'
import * as archiver from 'archiver'

const PLANET_BASE = 'https://api.planet.com/data/v1'
const CONCURRENCY = 4
const _basicAuth = (key: string) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`

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

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'success'
  msg: string
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
  pauseRequested: boolean
}

// ── Module state ─────────────────────────────────────────────────────────────

let _status: BatchStatus = {
  running: false, total: 0, processed: 0,
  archive: 0, tasking: 0, failed: 0, invalid: 0,
  startedAt: null, finishedAt: null, cancelRequested: false, pauseRequested: false
}

let _progressCallback: ((s: object) => void) | null = null
let _logCallback: ((e: LogEntry) => void) | null = null

export function registerProgressCallback(cb: (s: object) => void) {
  _progressCallback = cb
}

export function registerLogCallback(cb: (e: LogEntry) => void) {
  _logCallback = cb
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
    elapsedMs,
    finished: !!_status.finishedAt,
    paused: _status.pauseRequested
  })
}

function _log(level: LogEntry['level'], msg: string) {
  if (!_logCallback) return
  const now = new Date()
  _logCallback({ ts: now.toLocaleTimeString('en-US', { hour12: false }), level, msg })
}

export function getBatchStatus() {
  const now = new Date()
  const elapsedMs = _status.startedAt ? now.getTime() - _status.startedAt.getTime() : 0
  return { ..._status, elapsed: _formatDuration(elapsedMs) }
}

export function cancelBatch() {
  _status.cancelRequested = true
  _log('warn', 'Cancel requested — stopping after current tasks finish')
}

export function pauseBatch() {
  _status.pauseRequested = true
  _emit()
  _log('warn', 'Paused')
}

export function resumeBatch() {
  _status.pauseRequested = false
  _emit()
  _log('info', 'Resumed')
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

function _excelSerialToDate(serial: number): Date {
  // Excel serial 1 = Jan 1 1900; Excel incorrectly treats 1900 as a leap year
  const offset = serial > 60 ? serial - 2 : serial - 1
  return new Date(Date.UTC(1900, 0, 1) + offset * 86400000)
}

function _dateWindowFrom(dateVal: unknown, months: number): [string, string] | null {
  let d: Date
  if (typeof dateVal === 'number') {
    // Excel serial date (typical range 1–2958465 covers 1900–9999)
    if (dateVal < 1 || dateVal > 2958465) return null
    d = _excelSerialToDate(dateVal)
  } else {
    d = new Date(String(dateVal))
  }
  if (isNaN(d.getTime())) return null
  const end = new Date(d)
  end.setMonth(end.getMonth() + months)
  return [d.toISOString(), end.toISOString()]
}

async function _waitWhilePaused() {
  while (_status.pauseRequested && !_status.cancelRequested) {
    await _sleep(200)
  }
}

function _hasNullCoord(coords: unknown): boolean {
  if (coords === null || coords === undefined) return true
  if (typeof coords === 'number') return isNaN(coords)
  if (Array.isArray(coords)) return coords.some(_hasNullCoord)
  return false
}

function _getValidGeom(feat: any, buckets: any): { geom: any; props: any; featId: string } | null {
  const geom = feat.geometry
  const props = feat.properties ?? {}
  const featId = props.contract_id || props.id || `#${_status.processed + 1}`
  if (!geom || !geom.coordinates || _hasNullCoord(geom.coordinates)) {
    buckets.invalid.push({ ...feat, properties: { ...props, classification: 'invalid' } })
    _status.invalid++; _status.processed++; _emit()
    return null
  }
  return { geom, props, featId }
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
  const body = JSON.stringify({
    item_types: ['SkySatCollect'],
    filter: {
      type: 'AndFilter',
      config: [
        { type: 'GeometryFilter', field_name: 'geometry', config: geometry },
        { type: 'DateRangeFilter', field_name: 'acquired', config: { gte, lte } },
        { type: 'RangeFilter', field_name: 'cloud_cover', config: { lte: maxCloud / 100 } }
      ]
    }
  })
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let resp: Response
    try {
      resp = await fetch(`${PLANET_BASE}/quick-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: _basicAuth(apiKey) },
        body,
        signal: AbortSignal.timeout(30000)
      })
    } catch (err: any) {
      console.error('Planet API network error:', err.message)
      _log('error', `API net: ${err.message}`)
      return 'error'
    }
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get('retry-after') ?? '0', 10)
      const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt + 1) * 1000
      await _sleep(backoff)
      continue
    }
    if (!resp.ok) {
      const detail = await resp.text().then((t) => t.slice(0, 200)).catch(() => String(resp.status))
      console.error(`Planet API error (${resp.status}):`, detail)
      _log('error', `API ${resp.status}: ${detail}`)
      return 'error'
    }
    const data = await resp.json()
    const items: object[] = data?.features ?? []
    if (!items.length) return null
    // Sort client-side — API sort param is ignored
    items.sort((a: any, b: any) =>
      (a.properties?.cloud_cover ?? 1) - (b.properties?.cloud_cover ?? 1)
    )
    return items[0]
  }
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
  const tasks = features.map((feat) => async () => {
    await _waitWhilePaused()
    if (_status.cancelRequested) return

    const v = _getValidGeom(feat, buckets)
    if (!v) return
    const { geom, props, featId } = v

    const completionDate = props.completion_date
    let gte: string, lte: string

    if (completionDate) {
      const w = _dateWindowFrom(completionDate, opts.completionBufferMonths)
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
      _log('error', `${featId}: API search failed (window ${gte.slice(0,10)} → ${lte.slice(0,10)})`)
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
    await _waitWhilePaused()
    if (_status.cancelRequested) return

    const v = _getValidGeom(feat, buckets)
    if (!v) return
    const { geom, props, featId } = v

    const startDate = props.start_date
    const completionDate = props.completion_date

    if (!startDate || !completionDate) {
      buckets.invalid.push({ ...feat, properties: { ...props, classification: 'invalid_missing_dates' } })
      _status.invalid++; _status.processed++; _emit(); return
    }

    const startWindow = _dateWindowFrom(startDate, opts.startBufferMonths)
    const completionWindow = _dateWindowFrom(completionDate, opts.completionBufferMonths)

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
      _log('error', `${featId}: API search failed (paired mode)`)
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

function _computeStats(features: any[]) {
  if (!features.length) {
    return { count: 0, avg_cloud_cover_pct: null, cloud_distribution: {}, by_region: {}, by_satellite: {} }
  }
  const cloudLabels = ['0-5%', '5-10%', '10-15%', '15-20%', '20-25%', '25-30%', '>30%']
  const cloudDist: Record<string, number> = Object.fromEntries(cloudLabels.map((l) => [l, 0]))
  const byRegion: Record<string, number> = {}
  const bySatellite: Record<string, number> = {}
  let cloudSum = 0

  for (const f of features) {
    const p = f.properties ?? {}
    const cc = (p.cloud_cover ?? 0) * 100
    cloudSum += cc
    cloudDist[cloudLabels[Math.min(Math.floor(cc / 5), 6)]]++
    const r = p.region || 'Unknown'
    const s = p.satellite_id || 'Unknown'
    byRegion[r] = (byRegion[r] || 0) + 1
    bySatellite[s] = (bySatellite[s] || 0) + 1
  }

  const sortDesc = (obj: Record<string, number>) =>
    Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]))

  return {
    count: features.length,
    avg_cloud_cover_pct: Math.round((cloudSum / features.length) * 10) / 10,
    cloud_distribution: cloudDist,
    by_region: sortDesc(byRegion),
    by_satellite: sortDesc(bySatellite)
  }
}

// ── Public entry ─────────────────────────────────────────────────────────────

export async function runBatch(geojson: any, opts: BatchOptions, apiKey: string): Promise<object> {
  const features = geojson?.features ?? []

  _status = {
    running: true, total: features.length, processed: 0,
    archive: 0, tasking: 0, failed: 0, invalid: 0,
    startedAt: new Date(), finishedAt: null, cancelRequested: false, pauseRequested: false
  }
  _emit()
  _log('info', `Batch started — ${features.length} features, mode: ${opts.mode}`)

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

  // ── Write summary.json ──────────────────────────────────────────────────────
  const elapsedMs = _status.finishedAt!.getTime() - _status.startedAt!.getTime()
  const summary =
    opts.mode === 'paired'
      ? {
          generated_at: _status.finishedAt!.toISOString(),
          mode: 'paired',
          elapsed: _formatDuration(elapsedMs),
          cancelled: _status.cancelRequested,
          options: {
            max_cloud_cover_pct: opts.maxCloud,
            start_buffer_months: opts.startBufferMonths,
            completion_buffer_months: opts.completionBufferMonths
          },
          totals: {
            input_features: features.length,
            processed: _status.processed,
            archive_hits: _status.archive,
            tasking: _status.tasking,
            invalid: _status.invalid,
            errors: _status.failed
          },
          start_phase: {
            archive: buckets.startArchive.length,
            tasking: buckets.startTasking.length,
            hit_rate_pct: features.length > 0
              ? parseFloat(((buckets.startArchive.length / features.length) * 100).toFixed(1))
              : 0,
            archive_stats: _computeStats(buckets.startArchive)
          },
          completion_phase: {
            archive: buckets.completionArchive.length,
            tasking: buckets.completionTasking.length,
            hit_rate_pct: features.length > 0
              ? parseFloat(((buckets.completionArchive.length / features.length) * 100).toFixed(1))
              : 0,
            archive_stats: _computeStats(buckets.completionArchive)
          }
        }
      : {
          generated_at: _status.finishedAt!.toISOString(),
          mode: 'standard',
          elapsed: _formatDuration(elapsedMs),
          cancelled: _status.cancelRequested,
          options: {
            max_cloud_cover_pct: opts.maxCloud,
            completion_buffer_months: opts.completionBufferMonths,
            global_date_range: { gte: opts.datetimeGte, lte: opts.datetimeLte }
          },
          totals: {
            input_features: features.length,
            processed: _status.processed,
            archive: buckets.archive.length,
            tasking: buckets.tasking.length,
            invalid: _status.invalid,
            errors: _status.failed,
            hit_rate_pct: features.length > 0
              ? parseFloat(((buckets.archive.length / features.length) * 100).toFixed(1))
              : 0
          },
          archive_stats: _computeStats(buckets.archive)
        }

  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2))
  const wasCancelled = _status.cancelRequested
  _log(
    wasCancelled ? 'warn' : 'success',
    wasCancelled
      ? `Batch cancelled — ${_status.processed}/${_status.total} processed`
      : `Batch complete — archive:${_status.archive} tasking:${_status.tasking} invalid:${_status.invalid} errors:${_status.failed}`
  )

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
