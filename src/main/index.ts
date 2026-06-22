import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs'
import * as path from 'path'
import * as ExcelJS from 'exceljs'
import {
  runBatch, cancelBatch, pauseBatch, resumeBatch,
  getBatchStatus, registerProgressCallback, registerLogCallback,
  createZip, BatchOptions
} from './ipc/planet'
import { loadApiKey, saveApiKey, validateApiKey } from './ipc/settings'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const iconPath = is.dev
    ? join(__dirname, '../../resources/icons/png/planetextract-256.png')
    : join(process.resourcesPath, 'icons/png/planetextract-256.png')

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 840,
    minWidth: 1050,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  registerProgressCallback((status) => {
    mainWindow?.webContents.send('batch:progress', status)
  })

  registerLogCallback((entry) => {
    mainWindow?.webContents.send('batch:log', entry)
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pdr.planet-data-fetcher')

  app.on('browser-window-created', (_, win) => optimizer.watchWindowShortcuts(win))

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle('settings:load-key', () => loadApiKey())
  ipcMain.handle('settings:save-key', (_, key: string) => { saveApiKey(key) })
  ipcMain.handle('settings:validate-key', (_, key: string) => validateApiKey(key))

  // ── File I/O ──────────────────────────────────────────────────────────────
  ipcMain.handle('file:pick-geojson', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select GeoJSON file',
      filters: [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    const content = fs.readFileSync(result.filePaths[0], 'utf-8')
    return { name: path.basename(result.filePaths[0]), geojson: JSON.parse(content) }
  })

  ipcMain.handle('file:pick-any', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select XLSX or GeoJSON file',
      filters: [
        { name: 'Supported files', extensions: ['xlsx', 'xls', 'geojson', 'json'] },
        { name: 'Excel', extensions: ['xlsx', 'xls'] },
        { name: 'GeoJSON', extensions: ['geojson', 'json'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    const filePath = result.filePaths[0]
    const name = path.basename(filePath)
    const ext = path.extname(name).toLowerCase()
    if (ext === '.geojson' || ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf-8')
      return { type: 'geojson', name, filePath, content }
    }
    return { type: 'xlsx', name, filePath, content: null }
  })

  ipcMain.handle('file:xlsx-sheets', async (_, filePath: string) => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    return wb.worksheets.map((ws) => ws.name)
  })

  ipcMain.handle('file:pick-xlsx', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select XLSX file',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    const filePath = result.filePaths[0]
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const sheets = wb.worksheets.map((ws) => ws.name)
    return { name: path.basename(filePath), filePath, sheets }
  })

  function excelSerialToIso(val: unknown): string | null {
    if (val == null) return null
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString().slice(0, 10)
    if (typeof val === 'number' && val >= 1 && val <= 2958465) {
      const offset = val > 60 ? val - 2 : val - 1
      const d = new Date(Date.UTC(1900, 0, 1) + offset * 86400000)
      return d.toISOString().slice(0, 10)
    }
    const d = new Date(String(val))
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }

  ipcMain.handle('file:xlsx-to-geojson', async (_, filePath: string, sheetName: string) => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const ws = wb.getWorksheet(sheetName)
    if (!ws) throw new Error(`Sheet "${sheetName}" not found`)

    let headers: string[] = []
    const rows: Record<string, any>[] = []

    ws.eachRow((row, rowNum) => {
      const vals = row.values as any[]
      if (rowNum === 1) {
        headers = vals.slice(1).map((v) => String(v ?? '').trim())
        return
      }
      const obj: Record<string, any> = {}
      headers.forEach((h, i) => { obj[h] = vals[i + 1] ?? null })
      rows.push(obj)
    })

    const features: object[] = []
    let skipped = 0

    for (const row of rows) {
      const lat = parseFloat(row.latitude)
      const lon = parseFloat(row.longitude)
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        skipped++; continue
      }

      const half_lat = 0.5 / 111.32
      const half_lon = 0.5 / (111.32 * Math.cos((lat * Math.PI) / 180))

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [lon - half_lon, lat - half_lat],
            [lon + half_lon, lat - half_lat],
            [lon + half_lon, lat + half_lat],
            [lon - half_lon, lat + half_lat],
            [lon - half_lon, lat - half_lat]
          ]]
        },
        properties: {
          contract_id: String(row.contract_id ?? ''),
          region: String(row.region ?? ''),
          implementing_office: String(row.implementing_office ?? ''),
          year: String(row.year ?? ''),
          status: String(row.status ?? ''),
          start_date: excelSerialToIso(row.actual_start_date ?? row.start_date),
          completion_date: excelSerialToIso(row.completion_date)
        }
      })
    }

    return { geojson: { type: 'FeatureCollection', features }, converted: features.length, skipped }
  })

  // ── Batch ─────────────────────────────────────────────────────────────────
  ipcMain.handle('batch:run', async (_, geojson: object, opts: BatchOptions) => {
    const apiKey = loadApiKey()
    if (!apiKey) throw new Error('No API key configured')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outputDir = path.join(app.getPath('userData'), 'outputs', `batch_${ts}`)
    fs.mkdirSync(outputDir, { recursive: true })
    return runBatch(geojson, { ...opts, outputDir }, apiKey)
  })

  ipcMain.handle('batch:cancel', () => cancelBatch())
  ipcMain.handle('batch:pause', () => pauseBatch())
  ipcMain.handle('batch:resume', () => resumeBatch())
  ipcMain.handle('batch:status', () => getBatchStatus())

  // ── Download ──────────────────────────────────────────────────────────────
  ipcMain.handle('batch:save-geojson', async (_, outputDir: string, filename: string) => {
    const src = path.join(outputDir, 'output', filename)
    if (!fs.existsSync(src)) return null
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: `Save ${filename}`,
      defaultPath: filename,
      filters: [{ name: 'GeoJSON', extensions: ['geojson'] }]
    })
    if (result.canceled || !result.filePath) return null
    fs.copyFileSync(src, result.filePath)
    return result.filePath
  })

  ipcMain.handle('batch:open-summary', async (_, outputDir: string) => {
    const summaryPath = path.join(outputDir, 'output', 'summary.json')
    if (!fs.existsSync(summaryPath)) return false
    await shell.openPath(summaryPath)
    return true
  })

  ipcMain.handle('batch:download', async (_, outputDir: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save results as ZIP',
      defaultPath: path.basename(outputDir) + '.zip',
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return null
    await createZip(outputDir, result.filePath)
    return result.filePath
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
