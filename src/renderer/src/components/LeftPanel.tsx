import { useState } from 'react'
import { usePlanetStore } from '@renderer/globalConfig'

export default function LeftPanel() {
  const store = usePlanetStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)

  const loadGeojson = async (geojson: any, name: string) => {
    const feats = geojson?.features ?? []
    store.setGeojson(geojson, name, feats.length)
    setError('')
    // auto-detect mode
    const sample = feats.slice(0, 50)
    const hasStart = sample.some((f: any) => f.properties?.start_date)
    const hasCompletion = sample.some((f: any) => f.properties?.completion_date)
    if (hasStart && hasCompletion) store.setMode('paired')
    else store.setMode('standard')
  }

  const onPickFile = async () => {
    setLoading(true); setError('')
    try {
      const picked = await window.planet.pickFile()
      if (!picked) return
      if (picked.type === 'geojson') {
        await loadGeojson(JSON.parse(picked.content!), picked.name)
      } else {
        const sheets = await window.planet.xlsxSheets(picked.filePath)
        const sheet = sheets.includes('raw') ? 'raw' : sheets[0]
        store.setPendingXlsx({ filePath: picked.filePath, sheets })
        store.setSelectedSheet(sheet)
        const conv = await window.planet.xlsxToGeojson(picked.filePath, sheet)
        await loadGeojson(conv.geojson, picked.name)
        if (conv.skipped) setError(`${conv.skipped} rows skipped (bad coords/dates)`)
      }
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const onSheetChange = async (sheet: string) => {
    if (!store.pendingXlsx) return
    store.setSelectedSheet(sheet)
    setLoading(true)
    try {
      const conv = await window.planet.xlsxToGeojson(store.pendingXlsx.filePath, sheet)
      await loadGeojson(conv.geojson, store.pendingXlsx.name)
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const handleDroppedFile = async (file: File) => {
    const filePath = window.planet.getFilePath(file)
    const name = file.name
    setLoading(true); setError('')
    try {
      if (name.match(/\.(geojson|json)$/i)) {
        const text = await file.text()
        await loadGeojson(JSON.parse(text), name)
      } else if (name.match(/\.(xlsx|xls)$/i)) {
        const sheets = await window.planet.xlsxSheets(filePath)
        const sheet = sheets.includes('raw') ? 'raw' : sheets[0]
        store.setPendingXlsx({ filePath, sheets })
        store.setSelectedSheet(sheet)
        const conv = await window.planet.xlsxToGeojson(filePath, sheet)
        await loadGeojson(conv.geojson, name)
        if (conv.skipped) setError(`${conv.skipped} rows skipped (bad coords/dates)`)
      } else {
        setError('Only XLSX or GeoJSON files are supported')
      }
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleDroppedFile(file)
  }

  const onRun = async () => {
    if (!store.geojson || running) return
    setRunning(true)
    try {
      const result = await window.planet.runBatch(store.geojson, {
        mode: store.mode,
        datetimeGte: `${store.datetimeGte}T00:00:00Z`,
        datetimeLte: `${store.datetimeLte}T23:59:59Z`,
        maxCloud: store.maxCloud,
        completionBufferMonths: store.completionBufferMonths,
        startBufferMonths: store.startBufferMonths
      })
      store.setResults(result as any)
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setRunning(false)
    }
  }

  const canRun = !!store.geojson && !running

  return (
    <aside className="w-72 bg-base-100 border-r border-base-300 flex flex-col p-4 gap-3 overflow-y-auto">
      {/* Drop zone */}
      <div>
        <p className="label-text font-semibold text-xs uppercase tracking-wider opacity-60 mb-2">Data Input</p>
        <button
          className={`w-full border-2 border-dashed rounded-lg py-6 flex flex-col items-center gap-2 transition-colors cursor-pointer ${dragging ? 'border-primary bg-base-200' : 'border-base-300 hover:border-primary hover:bg-base-200'}`}
          onClick={onPickFile}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          disabled={loading}
        >
          {loading
            ? <span className="loading loading-spinner loading-md" />
            : <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-sm font-medium">{dragging ? 'Drop it!' : 'Drop or click to browse'}</span>
                <span className="text-xs opacity-50">XLSX or GeoJSON</span>
              </>
          }
        </button>

        {store.fileName && (
          <p className="text-xs mt-2 truncate">
            <span className="opacity-60">Loaded: </span>
            <span className="font-medium">{store.fileName}</span>
            {store.featCount > 0 && <span className="badge badge-sm ml-2">{store.featCount.toLocaleString()}</span>}
          </p>
        )}

        {store.pendingXlsx && (
          <select
            className="select select-bordered select-sm w-full mt-2"
            value={store.selectedSheet}
            onChange={(e) => onSheetChange(e.target.value)}
          >
            {store.pendingXlsx.sheets.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {error && <p className="text-error text-xs mt-1">{error}</p>}
      </div>

      <div className="divider my-0" />

      {/* Mode */}
      <div>
        <p className="label-text font-semibold text-xs uppercase tracking-wider opacity-60 mb-2">Mode</p>
        <select
          className="select select-bordered select-sm w-full"
          value={store.mode}
          onChange={(e) => store.setMode(e.target.value as any)}
        >
          <option value="standard">Standard (completion window)</option>
          <option value="paired">Paired (start + completion)</option>
        </select>
        <p className="text-xs opacity-50 mt-1">
          {store.mode === 'paired'
            ? 'Two queries per centroid — start & completion dates'
            : 'One query per centroid — completion date window'}
        </p>
      </div>

      {/* Buffers */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label py-0"><span className="label-text text-xs">Completion buffer (mo)</span></label>
          <input type="number" className="input input-bordered input-sm w-full"
            value={store.completionBufferMonths} min={1} max={24}
            onChange={(e) => store.setCompletionBuffer(Number(e.target.value))} />
        </div>
        {store.mode === 'paired' && (
          <div>
            <label className="label py-0"><span className="label-text text-xs">Start buffer (mo)</span></label>
            <input type="number" className="input input-bordered input-sm w-full"
              value={store.startBufferMonths} min={1} max={24}
              onChange={(e) => store.setStartBuffer(Number(e.target.value))} />
          </div>
        )}
      </div>

      {/* Date range */}
      <div>
        <p className="label-text font-semibold text-xs uppercase tracking-wider opacity-60 mb-2">Global Date Range</p>
        <p className="text-xs opacity-50 mb-2">Fallback for features without a completion date</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label py-0"><span className="label-text text-xs">From</span></label>
            <input type="date" className="input input-bordered input-sm w-full"
              value={store.datetimeGte}
              onChange={(e) => store.setDatetimeGte(e.target.value)} />
          </div>
          <div>
            <label className="label py-0"><span className="label-text text-xs">To</span></label>
            <input type="date" className="input input-bordered input-sm w-full"
              value={store.datetimeLte}
              onChange={(e) => store.setDatetimeLte(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Cloud cover */}
      <div>
        <p className="label-text font-semibold text-xs uppercase tracking-wider opacity-60 mb-1">Max Cloud Cover</p>
        <div className="flex items-center gap-2">
          <input type="range" className="range range-primary range-sm flex-1"
            min={0} max={100} step={5}
            value={store.maxCloud}
            onChange={(e) => store.setMaxCloud(Number(e.target.value))} />
          <span className="text-sm font-medium w-10 text-right">{store.maxCloud}%</span>
        </div>
      </div>

      <div className="mt-auto">
        <button
          className="btn btn-primary w-full"
          onClick={onRun}
          disabled={!canRun}
        >
          {running ? <><span className="loading loading-spinner loading-sm" /> Running…</> : 'Run Batch'}
        </button>
      </div>
    </aside>
  )
}
