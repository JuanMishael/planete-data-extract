import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

interface Settings {
  apiKey: string
}

function _read(): Settings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    }
  } catch {}
  return { apiKey: '' }
}

function _write(s: Settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2))
}

export function loadApiKey(): string {
  return _read().apiKey
}

export function saveApiKey(key: string) {
  _write({ ..._read(), apiKey: key })
}

export async function validateApiKey(key: string): Promise<boolean> {
  try {
    const resp = await axios.get('https://api.planet.com/data/v1', {
      auth: { username: key, password: '' },
      timeout: 10000
    })
    return resp.status === 200
  } catch {
    return false
  }
}
