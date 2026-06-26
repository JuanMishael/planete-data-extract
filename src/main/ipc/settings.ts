import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

function _read(): { apiKey: string } {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    }
  } catch {}
  return { apiKey: '' }
}

function _write(s: { apiKey: string }) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2))
}

export function loadApiKey(): string {
  return _read().apiKey
}

export function saveApiKey(key: string) {
  _write({ apiKey: key })
}

export async function validateApiKey(key: string): Promise<boolean> {
  try {
    const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`
    const resp = await fetch('https://api.planet.com/data/v1', {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10000)
    })
    return resp.ok
  } catch {
    return false
  }
}
