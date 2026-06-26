import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('planet', {
  // Settings
  loadKey: () => ipcRenderer.invoke('settings:load-key'),
  saveKey: (key: string) => ipcRenderer.invoke('settings:save-key', key),
  validateKey: (key: string) => ipcRenderer.invoke('settings:validate-key', key),

  // File I/O
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  pickFile: () => ipcRenderer.invoke('file:pick-any'),
  pickGeojson: () => ipcRenderer.invoke('file:pick-geojson'),
  xlsxSheets: (filePath: string) => ipcRenderer.invoke('file:xlsx-sheets', filePath),
  xlsxToGeojson: (filePath: string, sheet: string) =>
    ipcRenderer.invoke('file:xlsx-to-geojson', filePath, sheet),

  // Batch
  runBatch: (geojson: object, opts: object) => ipcRenderer.invoke('batch:run', geojson, opts),
  cancelBatch: () => ipcRenderer.invoke('batch:cancel'),
  pauseBatch: () => ipcRenderer.invoke('batch:pause'),
  resumeBatch: () => ipcRenderer.invoke('batch:resume'),
  getStatus: () => ipcRenderer.invoke('batch:status'),
  saveGeojson: (outputDir: string, filename: string) => ipcRenderer.invoke('batch:save-geojson', outputDir, filename),
  openSummary: (outputDir: string) => ipcRenderer.invoke('batch:open-summary', outputDir),
  download: (outputDir: string) => ipcRenderer.invoke('batch:download', outputDir),

  // Events
  onProgress: (cb: (status: object) => void) =>
    ipcRenderer.on('batch:progress', (_, s) => cb(s)),
  onLog: (cb: (entry: object) => void) =>
    ipcRenderer.on('batch:log', (_, e) => cb(e))
})
