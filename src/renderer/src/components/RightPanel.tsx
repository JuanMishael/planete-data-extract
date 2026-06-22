import { useEffect, useRef, useState } from 'react'
import { usePlanetStore } from '@renderer/globalConfig'
import ResultsTable from './ResultsTable'
import Analytics from './Analytics'

export default function RightPanel() {
  const progress = usePlanetStore((s) => s.progress)
  const results = usePlanetStore((s) => s.results)
  const logs = usePlanetStore((s) => s.logs)
  const clearLogs = usePlanetStore((s) => s.clearLogs)
  const [tab, setTab] = useState<'results' | 'analytics' | 'logs'>('results')
  const [downloading, setDownloading] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab === 'logs') logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, tab])

  const pct = progress && progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0

  const isInitializing = !!(progress?.running && progress.processed === 0 && !progress.finished)

  const eta = (() => {
    if (!progress?.running || progress.finished || progress.paused) return ''
    if (!progress.elapsedMs || progress.processed === 0) return ''
    const rate = progress.processed / (progress.elapsedMs / 1000)
    const remaining = (progress.total - progress.processed) / rate
    if (remaining < 5) return ''
    const s = Math.floor(remaining)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    const str = h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`
    return `~${str} left`
  })()

  const speed = (() => {
    if (!progress?.running || progress.finished || !progress.elapsedMs || progress.processed < 4) return ''
    const rate = progress.processed / (progress.elapsedMs / 1000)
    return `${rate.toFixed(1)}/s`
  })()

  const onDownload = async () => {
    if (!results?.outputDir) return
    setDownloading(true)
    try {
      const dest = await window.planet.download(results.outputDir)
      if (dest) alert(`Saved to: ${dest}`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Archive', value: progress?.archive ?? 0, color: 'text-success' },
          { label: 'Tasking', value: progress?.tasking ?? 0, color: 'text-warning' },
          { label: 'Invalid', value: progress?.invalid ?? 0, color: 'opacity-50' },
          { label: 'Errors',  value: progress?.failed  ?? 0, color: 'text-error' }
        ].map((c) => (
          <div key={c.label} className="bg-base-100 border border-base-300 rounded-lg p-3 flex flex-col items-center">
            {isInitializing
              ? <div className="skeleton h-8 w-12 rounded mb-1" />
              : <span className={`text-2xl font-bold ${c.color}`}>{c.value.toLocaleString()}</span>
            }
            <span className="text-xs opacity-50 mt-1">{c.label}</span>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="bg-base-100 border border-base-300 rounded-lg p-3">
        <div className="flex justify-between text-xs opacity-60 mb-1">
          <span>
            {isInitializing
              ? 'Initializing batch…'
              : progress
                ? progress.finished
                  ? `Completed  •  ${progress.elapsed}`
                  : progress.paused
                    ? `Paused  •  ${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}  •  ${progress.elapsed}`
                    : `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}  •  ${progress.elapsed}`
                : 'Ready'}
          </span>
          <span className="flex gap-2">
            {speed && <span className="opacity-50">{speed}</span>}
            {eta && <span>{eta}</span>}
            {!isInitializing && <span>{pct}%</span>}
          </span>
        </div>
        {isInitializing
          ? <progress className="progress progress-primary w-full" />
          : <progress
              className={`progress w-full ${progress?.paused ? 'progress-warning' : 'progress-primary'}`}
              value={pct}
              max={100}
            />
        }
      </div>

      {/* Tabs */}
      <div className="tabs tabs-bordered">
        <button className={`tab ${tab === 'results' ? 'tab-active' : ''}`} onClick={() => setTab('results')}>Results</button>
        <button className={`tab ${tab === 'analytics' ? 'tab-active' : ''}`} onClick={() => setTab('analytics')}>Analytics</button>
        <button className={`tab ${tab === 'logs' ? 'tab-active' : ''}`} onClick={() => setTab('logs')}>
          Logs
          {logs.length > 0 && <span className="badge badge-sm ml-1">{logs.length}</span>}
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-base-100 border border-base-300 rounded-lg p-3">
        {tab === 'results' && <ResultsTable />}
        {tab === 'analytics' && <Analytics />}
        {tab === 'logs' && (
          <div className="font-mono text-xs flex flex-col gap-0.5">
            {logs.length > 0 && (
              <button className="btn btn-xs btn-ghost self-end mb-1 opacity-50" onClick={clearLogs}>Clear</button>
            )}
            {logs.length === 0 && (
              <p className="opacity-40 text-center mt-8">No logs yet — run a batch to see activity here.</p>
            )}
            {logs.map((entry, i) => (
              <div key={i} className={`flex gap-2 py-0.5 border-b border-base-300 ${
                entry.level === 'error' ? 'text-error' :
                entry.level === 'warn'  ? 'text-warning' :
                entry.level === 'success' ? 'text-success' :
                'text-base-content opacity-70'
              }`}>
                <span className="opacity-50 shrink-0">{entry.ts}</span>
                <span className="break-all">{entry.msg}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          className="btn btn-outline btn-sm"
          onClick={onDownload}
          disabled={!results?.outputDir || downloading}
        >
          {downloading ? <><span className="loading loading-spinner loading-xs" /> Creating ZIP…</> : 'Download Results'}
        </button>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => results?.outputDir && window.planet.openSummary(results.outputDir)}
          disabled={!results?.outputDir}
        >
          Open Summary
        </button>
      </div>
    </main>
  )
}
