import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  loadOrInitSettings, loadSettings, saveSettings, applyToEnv, toView,
  isDesktop, settingsFilePath, DOCKER_TRANSLATE_URL, DEFAULT_SETTINGS,
} from '../../server/settings'

const ENV_KEYS = [
  'RESUME_DATA_DIR', 'RESUME_DESKTOP', 'LIBRETRANSLATE_URL', 'LIBRETRANSLATE_API_KEY',
  'RESUME_BACKUP_DIR', 'RESUME_BACKUP_INTERVAL_MS', 'TRANSLATE_PROVIDER',
  'DEEPL_API_KEY', 'GOOGLE_TRANSLATE_API_KEY', 'AZURE_TRANSLATOR_KEY', 'AZURE_TRANSLATOR_REGION',
]
const savedEnv: Record<string, string | undefined> = {}
let dir: string

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-set-'))
  process.env.RESUME_DATA_DIR = dir
})
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('isDesktop', () => {
  it('reflects RESUME_DESKTOP', () => {
    expect(isDesktop()).toBe(false)
    process.env.RESUME_DESKTOP = '1'
    expect(isDesktop()).toBe(true)
  })
})

describe('loadOrInitSettings', () => {
  it('creates a settings file with defaults on first run', () => {
    const s = loadOrInitSettings()
    expect(fs.existsSync(settingsFilePath())).toBe(true)
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('seeds from existing env on first run (preserves shim/system values)', () => {
    process.env.LIBRETRANSLATE_URL = 'https://lt.example.com'
    process.env.RESUME_BACKUP_DIR = '/drive/rs'
    const s = loadOrInitSettings()
    expect(s.libretranslate_url).toBe('https://lt.example.com')
    expect(s.backup_dir).toBe('/drive/rs')
    // Persisted, so a later load (env now empty) still has them.
    delete process.env.LIBRETRANSLATE_URL
    expect(loadSettings().libretranslate_url).toBe('https://lt.example.com')
  })

  it('applies settings onto process.env', () => {
    process.env.LIBRETRANSLATE_URL = 'https://lt.example.com'
    loadOrInitSettings()
    expect(process.env.LIBRETRANSLATE_URL).toBe('https://lt.example.com')
  })
})

describe('saveSettings + applyToEnv', () => {
  it('docker mode forces the LibreTranslate URL to the docker URL', () => {
    loadOrInitSettings()
    saveSettings({ translate_provider: 'libretranslate', translate_docker: true })
    expect(process.env.LIBRETRANSLATE_URL).toBe(DOCKER_TRANSLATE_URL)
    expect(process.env.TRANSLATE_PROVIDER).toBe('libretranslate')
    expect(loadSettings().translate_docker).toBe(true)
  })

  it('persists a cloud provider + its key and applies them to env', () => {
    loadOrInitSettings()
    const s = saveSettings({ translate_provider: 'deepl', deepl_api_key: 'k:fx' })
    expect(s.translate_provider).toBe('deepl')
    expect(process.env.TRANSLATE_PROVIDER).toBe('deepl')
    expect(process.env.DEEPL_API_KEY).toBe('k:fx')
    expect(loadSettings().deepl_api_key).toBe('k:fx')
    // The view masks every provider key.
    expect(toView(loadSettings()).deepl_api_key_set).toBe(true)
    expect(toView(loadSettings())).not.toHaveProperty('deepl_api_key')
  })

  it('rejects an unknown provider via coerce (falls back to off)', () => {
    loadOrInitSettings()
    // @ts-expect-error — deliberately invalid provider value
    const s = saveSettings({ translate_provider: 'bogus' })
    expect(s.translate_provider).toBe('off')
  })

  it('turning translate off clears the URL env', () => {
    loadOrInitSettings()
    saveSettings({ libretranslate_url: 'https://lt.example.com' })
    expect(process.env.LIBRETRANSLATE_URL).toBe('https://lt.example.com')
    saveSettings({ libretranslate_url: '', translate_docker: false })
    expect(process.env.LIBRETRANSLATE_URL).toBeUndefined()
  })

  it('persists + applies the backup folder and interval', () => {
    loadOrInitSettings()
    saveSettings({ backup_dir: '/drive/rs', backup_interval_ms: 120000 })
    expect(process.env.RESUME_BACKUP_DIR).toBe('/drive/rs')
    expect(process.env.RESUME_BACKUP_INTERVAL_MS).toBe('120000')
    const reloaded = loadSettings()
    expect(reloaded.backup_dir).toBe('/drive/rs')
    expect(reloaded.backup_interval_ms).toBe(120000)
  })

  it('clamps an absurdly small interval up to the floor', () => {
    loadOrInitSettings()
    const s = saveSettings({ backup_interval_ms: 10 })
    expect(s.backup_interval_ms).toBe(5000)
  })

  it('a blank backup_dir clears the env var (sync off)', () => {
    loadOrInitSettings()
    saveSettings({ backup_dir: '/drive/rs' })
    saveSettings({ backup_dir: '' })
    expect(process.env.RESUME_BACKUP_DIR).toBeUndefined()
  })
})

describe('toView', () => {
  it('masks the API key to a boolean', () => {
    const view = toView({ ...DEFAULT_SETTINGS, libretranslate_api_key: 'secret' })
    expect(view).not.toHaveProperty('libretranslate_api_key')
    expect(view.libretranslate_api_key_set).toBe(true)
    expect(toView(DEFAULT_SETTINGS).libretranslate_api_key_set).toBe(false)
  })
})

describe('applyToEnv directly', () => {
  it('clears keys for empty values', () => {
    process.env.LIBRETRANSLATE_URL = 'x'
    process.env.RESUME_BACKUP_DIR = 'y'
    applyToEnv(DEFAULT_SETTINGS)
    expect(process.env.LIBRETRANSLATE_URL).toBeUndefined()
    expect(process.env.RESUME_BACKUP_DIR).toBeUndefined()
  })
})
