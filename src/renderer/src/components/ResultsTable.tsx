import { useState } from 'react'
import { usePlanetStore } from '@renderer/globalConfig'

function GeoJSONDownloadBtn({ outputDir, filename, label }: { outputDir: string; filename: string; label: string }) {
  const [saving, setSaving] = useState(false)
  const onSave = async () => {
    setSaving(true)
    try { await window.planet.saveGeojson(outputDir, filename) }
    finally { setSaving(false) }
  }
  return (
    <button className="btn btn-xs btn-outline gap-1" onClick={onSave} disabled={saving}>
      {saving ? <span className="loading loading-spinner loading-xs" /> : (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      )}
      {label}
    </button>
  )
}

export default function ResultsTable() {
  const results = usePlanetStore((s) => s.results)

  if (!results) {
    return <p className="text-sm opacity-50 italic">No results yet — run a batch to see archive hits.</p>
  }

  const { summary, archive, outputDir, mode } = results
  const features = archive as any[]
  const paired = mode === 'paired'

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="bg-base-200 rounded-lg p-4">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-50 mb-3">Batch Summary</p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {[
            { label: 'Total Processed', value: summary.total.toLocaleString(), color: '' },
            { label: 'Hit Rate', value: `${summary.hitRate}%`, color: 'text-primary' },
            { label: 'Archive Hits', value: summary.archive.toLocaleString(), color: 'text-success' },
            { label: 'Tasking', value: summary.tasking.toLocaleString(), color: 'text-warning' },
            { label: 'Invalid', value: summary.invalid.toLocaleString(), color: 'opacity-50' },
            { label: 'Errors', value: summary.errors.toLocaleString(), color: 'text-error' },
          ].map((s) => (
            <div key={s.label} className="bg-base-100 rounded p-2 text-center">
              <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs opacity-50">{s.label}</div>
            </div>
          ))}
        </div>

        {/* GeoJSON download buttons */}
        <div className="flex flex-wrap gap-2 mt-2">
          <p className="text-xs opacity-50 w-full">Download GeoJSON files:</p>
          {paired ? (
            <>
              <GeoJSONDownloadBtn outputDir={outputDir} filename="start/archive.geojson" label="Start Archive" />
              <GeoJSONDownloadBtn outputDir={outputDir} filename="completion/archive.geojson" label="Completion Archive" />
              <GeoJSONDownloadBtn outputDir={outputDir} filename="start/tasking.geojson" label="Start Tasking" />
              <GeoJSONDownloadBtn outputDir={outputDir} filename="completion/tasking.geojson" label="Completion Tasking" />
            </>
          ) : (
            <>
              <GeoJSONDownloadBtn outputDir={outputDir} filename="archive.geojson" label="Archive" />
              <GeoJSONDownloadBtn outputDir={outputDir} filename="tasking.geojson" label="Tasking" />
            </>
          )}
          {summary.invalid > 0 && (
            <GeoJSONDownloadBtn outputDir={outputDir} filename="invalid.geojson" label={`Invalid (${summary.invalid})`} />
          )}
          {summary.errors > 0 && (
            <GeoJSONDownloadBtn outputDir={outputDir} filename="errors.geojson" label={`Errors (${summary.errors})`} />
          )}
        </div>
      </div>

      {/* Archive results table */}
      {features.length > 0 ? (
        <div className="overflow-x-auto">
          <p className="text-sm font-medium text-success mb-2">{features.length.toLocaleString()} archive hits</p>
          <table className="table table-xs table-zebra">
            <thead>
              <tr>
                <th>Contract ID</th>
                <th>Region</th>
                <th>Planet ID</th>
                <th>Cloud</th>
                <th>Clear</th>
                <th>Acquired</th>
                <th>Satellite</th>
                {paired && <th>Phase</th>}
              </tr>
            </thead>
            <tbody>
              {features.map((feat: any, i) => {
                const p = feat.properties ?? {}
                const cloud = p.cloud_cover != null ? (p.cloud_cover * 100).toFixed(0) + '%' : '—'
                const cloudClass = p.cloud_cover < 0.1 ? 'text-success' : p.cloud_cover < 0.25 ? 'text-warning' : ''
                return (
                  <tr key={i}>
                    <td>{p.contract_id || '—'}</td>
                    <td className="opacity-60">{p.region || '—'}</td>
                    <td className="font-mono text-primary text-xs">{p.planet_id || '—'}</td>
                    <td className={cloudClass}>{cloud}</td>
                    <td className="opacity-60">{p.clear_percent != null ? `${p.clear_percent}%` : '—'}</td>
                    <td className="opacity-60">{p.acquired ? String(p.acquired).slice(0, 10) : '—'}</td>
                    <td className="opacity-60">{p.satellite_id || '—'}</td>
                    {paired && (
                      <td>
                        <span className={`badge badge-xs ${p._buffer === 'start' ? 'badge-info' : 'badge-success'}`}>
                          {p._buffer || '—'}
                        </span>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm opacity-50 italic">No archive hits found.</p>
      )}
    </div>
  )
}
