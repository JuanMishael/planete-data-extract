import { usePlanetStore } from '@renderer/globalConfig'

function PhaseSection({ features, label, color }: { features: any[], label: string, color: string }) {
  if (!features.length) return <p className="text-sm opacity-50 italic">No {label.toLowerCase()} hits.</p>

  const clouds = features.map((f) => (f.properties?.cloud_cover ?? 0) * 100)
  const avgCloud = clouds.reduce((a, b) => a + b, 0) / clouds.length
  const totalIn = features.length

  const buckets = Array(7).fill(0)
  clouds.forEach((c) => { buckets[Math.min(Math.floor(c / 5), 6)]++ })
  const maxB = Math.max(...buckets) || 1
  const labels = ['0–5%', '5–10%', '10–15%', '15–20%', '20–25%', '25–30%', '>30%']

  const regions: Record<string, number> = {}
  const sats: Record<string, number> = {}
  features.forEach((f) => {
    const r = f.properties?.region || '?'
    const s = f.properties?.satellite_id || '?'
    regions[r] = (regions[r] || 0) + 1
    sats[s] = (sats[s] || 0) + 1
  })
  const topRegions = Object.entries(regions).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const satList = Object.entries(sats).sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className={`flex-1 bg-base-200 rounded-lg p-2 text-center`}>
          <div className={`text-xl font-bold ${color}`}>{features.length.toLocaleString()}</div>
          <div className="text-xs opacity-50">Archive Hits</div>
        </div>
        <div className="flex-1 bg-base-200 rounded-lg p-2 text-center">
          <div className="text-xl font-bold text-warning">{avgCloud.toFixed(1)}%</div>
          <div className="text-xs opacity-50">Avg Cloud</div>
        </div>
        <div className="flex-1 bg-base-200 rounded-lg p-2 text-center">
          <div className="text-xl font-bold">{satList.length}</div>
          <div className="text-xs opacity-50">Satellites</div>
        </div>
      </div>

      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-50 mb-2">Cloud Cover</p>
        {labels.map((lbl, i) => (
          <div key={lbl} className="flex items-center gap-2 mb-1">
            <span className="text-xs opacity-50 w-12 shrink-0">{lbl}</span>
            <div className="flex-1 bg-base-300 rounded h-2">
              <div
                className={`h-2 rounded ${i === 0 ? 'bg-success' : 'bg-warning'}`}
                style={{ width: `${(buckets[i] / maxB) * 100}%` }}
              />
            </div>
            <span className="text-xs opacity-50 w-6 text-right">{buckets[i]}</span>
          </div>
        ))}
      </div>

      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-50 mb-2">Hits by Region</p>
        <table className="table table-xs">
          <tbody>
            {topRegions.map(([r, c]) => (
              <tr key={r}>
                <td>{r}</td>
                <td className="text-success font-medium text-right">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-50 mb-2">Satellites</p>
        <div className="flex flex-wrap gap-1">
          {satList.map(([s, c]) => (
            <span key={s} className="badge badge-outline badge-sm">{s} {c}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Analytics() {
  const results = usePlanetStore((s) => s.results)

  if (!results) {
    return <p className="text-sm opacity-50 italic">Run a batch to see analytics.</p>
  }

  const features = results.archive as any[]
  const paired = results.mode === 'paired'

  if (!paired) {
    return <PhaseSection features={features} label="Archive" color="text-primary" />
  }

  const startFeats = features.filter((f) => f.properties?._buffer === 'start')
  const completionFeats = features.filter((f) => f.properties?._buffer === 'completion')

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 bg-info rounded" />
          <span className="font-semibold text-info">Start Phase</span>
          <span className="text-xs opacity-50">({startFeats.length} hits)</span>
        </div>
        <PhaseSection features={startFeats} label="Start" color="text-info" />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-4 bg-success rounded" />
          <span className="font-semibold text-success">Completion Phase</span>
          <span className="text-xs opacity-50">({completionFeats.length} hits)</span>
        </div>
        <PhaseSection features={completionFeats} label="Completion" color="text-success" />
      </div>
    </div>
  )
}
