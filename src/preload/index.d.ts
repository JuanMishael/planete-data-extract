export {}

declare global {
  interface Window {
    planet: {
      loadKey: () => Promise<string>
      saveKey: (key: string) => Promise<void>
      validateKey: (key: string) => Promise<boolean>
      getFilePath: (file: File) => string
      pickFile: () => Promise<{ type: 'geojson' | 'xlsx'; name: string; filePath: string; content: string | null } | null>
      pickGeojson: () => Promise<{ name: string; geojson: object } | null>
      pickXlsx: () => Promise<{ name: string; filePath: string; sheets: string[] } | null>
      xlsxSheets: (filePath: string) => Promise<string[]>
      xlsxToGeojson: (filePath: string, sheet: string) => Promise<{ geojson: object; converted: number; skipped: number }>
      runBatch: (geojson: object, opts: object) => Promise<{ mode: string; archive: object[]; outputDir: string }>
      cancelBatch: () => Promise<void>
      pauseBatch: () => Promise<void>
      resumeBatch: () => Promise<void>
      getStatus: () => Promise<object>
      saveGeojson: (outputDir: string, filename: string) => Promise<string | null>
      openSummary: (outputDir: string) => Promise<boolean>
      download: (outputDir: string) => Promise<string | null>
      onProgress: (cb: (status: BatchProgress) => void) => void
      onLog: (cb: (entry: LogEntry) => void) => void
    }
  }

  interface BatchProgress {
    running: boolean
    total: number
    processed: number
    archive: number
    tasking: number
    failed: number
    invalid: number
    elapsed: string
    elapsedMs: number
    finished: boolean
    paused: boolean
  }

  interface LogEntry {
    ts: string
    level: 'info' | 'warn' | 'error' | 'success'
    msg: string
  }
}
