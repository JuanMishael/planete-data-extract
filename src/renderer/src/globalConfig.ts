import { create } from 'zustand'

export type BatchMode = 'standard' | 'paired'

export interface PlanetConfig {
  geojson: object | null
  fileName: string
  featCount: number
  // pending xlsx (for sheet selection)
  pendingXlsx: { filePath: string; sheets: string[] } | null
  selectedSheet: string
  // filters
  mode: BatchMode
  datetimeGte: string
  datetimeLte: string
  maxCloud: number
  completionBufferMonths: number
  startBufferMonths: number
  // batch
  progress: BatchProgress | null
  results: {
    mode: string
    outputDir: string
    archive: object[]
    invalid: object[]
    errored: object[]
    summary: { total: number; archive: number; tasking: number; invalid: number; errors: number; hitRate: string }
  } | null
  // logs
  logs: LogEntry[]
  // setters
  setGeojson: (g: object, name: string, count: number) => void
  setPendingXlsx: (v: { filePath: string; sheets: string[] } | null) => void
  setSelectedSheet: (s: string) => void
  setMode: (m: BatchMode) => void
  setDatetimeGte: (d: string) => void
  setDatetimeLte: (d: string) => void
  setMaxCloud: (v: number) => void
  setCompletionBuffer: (v: number) => void
  setStartBuffer: (v: number) => void
  setProgress: (p: BatchProgress) => void
  setResults: (r: NonNullable<PlanetConfig['results']>) => void
  addLog: (e: LogEntry) => void
  clearLogs: () => void
  reset: () => void
}

const today = new Date().toISOString().slice(0, 10)
const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

export const usePlanetStore = create<PlanetConfig>((set) => ({
  geojson: null,
  fileName: '',
  featCount: 0,
  pendingXlsx: null,
  selectedSheet: 'raw',
  mode: 'standard',
  datetimeGte: oneYearAgo,
  datetimeLte: today,
  maxCloud: 30,
  completionBufferMonths: 6,
  startBufferMonths: 1,
  progress: null,
  results: null,
  logs: [],

  setGeojson: (g, name, count) => set({ geojson: g, fileName: name, featCount: count }),
  setPendingXlsx: (v) => set({ pendingXlsx: v }),
  setSelectedSheet: (s) => set({ selectedSheet: s }),
  setMode: (m) => set({ mode: m }),
  setDatetimeGte: (d) => set({ datetimeGte: d }),
  setDatetimeLte: (d) => set({ datetimeLte: d }),
  setMaxCloud: (v) => set({ maxCloud: v }),
  setCompletionBuffer: (v) => set({ completionBufferMonths: v }),
  setStartBuffer: (v) => set({ startBufferMonths: v }),
  setProgress: (p) => set({ progress: p }),
  setResults: (r) => set({ results: r }),
  addLog: (e) => set((s) => ({ logs: [...s.logs.slice(-499), e] })),
  clearLogs: () => set({ logs: [] }),
  reset: () => set({ geojson: null, fileName: '', featCount: 0, progress: null, results: null, logs: [] })
}))
