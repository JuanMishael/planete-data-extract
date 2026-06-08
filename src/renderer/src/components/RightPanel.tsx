import { useState } from 'react'
import { usePlanetStore } from '@renderer/globalConfig'
import ResultsTable from './ResultsTable'
import Analytics from './Analytics'

export default function RightPanel() {
  const progress = usePlanetStore((s) => s.progress)
  const results = usePlanetStore((s) => s.results)
  const [tab, setTab] = useState<'results' | 'analytics'>('results')
  const [downloading, setDownloading] = useState(false)

  const pct = progress && progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0

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
          { label: 'Invalid', value: progress?.invalid ?? 0, color: 'text-base-content opacity-50' },
          { label: 'Errors',  value: progress?.failed  ?? 0, color: 'text-error' }
        ].map((c) => (
          <div key={c.label} className="bg-base-100 border border-base-300 rounded-lg p-3 flex flex-col items-center">
            <span className={`text-2xl font-bold ${c.color}`}>{c.value.toLocaleString()}</span>
            <span className="text-xs opacity-50 mt-1">{c.label}</span>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="bg-base-100 border border-base-300 rounded-lg p-3">
        <div className="flex justify-between text-xs opacity-60 mb-1">
          <span>
            {progress
              ? progress.finished
                ? `Completed  •  ${progress.elapsed}`
                : `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}  •  ${progress.elapsed}`
              : 'Ready'}
          </span>
          <span>{pct}%</span>
        </div>
        <progress className="progress progress-primary w-full" value={pct} max={100} />
      </div>

      {/* Tabs */}
      <div className="tabs tabs-bordered">
        <button className={`tab ${tab === 'results' ? 'tab-active' : ''}`} onClick={() => setTab('results')}>Results</button>
        <button className={`tab ${tab === 'analytics' ? 'tab-active' : ''}`} onClick={() => setTab('analytics')}>Analytics</button>
      </div>

      <div className="flex-1 overflow-auto bg-base-100 border border-base-300 rounded-lg p-3">
        {tab === 'results'
          ? <ResultsTable />
          : <Analytics />
        }
      </div>

      {/* Download */}
      <button
        className="btn btn-outline btn-sm self-start"
        onClick={onDownload}
        disabled={!results?.outputDir || downloading}
      >
        {downloading ? <><span className="loading loading-spinner loading-xs" /> Creating ZIP…</> : 'Download Results'}
      </button>
    </main>
  )
}
