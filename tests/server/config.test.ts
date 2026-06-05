import { describe, it, expect } from 'vitest'
import path from 'path'
import { defaultDataDir, resolvePaths } from '../../server/config'

// NOTE: these functions use `path.join`, which emits the HOST OS separator
// regardless of the `platform` argument (the argument only selects the naming
// convention — APPDATA vs XDG — not the slash style). In production host ===
// target, so the result is always right. Tests therefore build expected paths
// with `path.join` too, so they pass on any CI OS.

describe('defaultDataDir — per-platform conventions', () => {
  it('uses %APPDATA%\\ResumeStudio on Windows', () => {
    const appData = path.join('C:', 'Users', 'me', 'AppData', 'Roaming')
    const dir = defaultDataDir('win32', { APPDATA: appData }, path.join('C:', 'Users', 'me'))
    expect(dir).toBe(path.join(appData, 'ResumeStudio'))
  })

  it('falls back to <home>/AppData/Roaming on Windows when APPDATA is unset', () => {
    const home = path.join('C:', 'Users', 'me')
    const dir = defaultDataDir('win32', {}, home)
    expect(dir).toBe(path.join(home, 'AppData', 'Roaming', 'ResumeStudio'))
  })

  it('uses ~/Library/Application Support/ResumeStudio on macOS', () => {
    const home = path.join('/Users', 'me')
    const dir = defaultDataDir('darwin', {}, home)
    expect(dir).toBe(path.join(home, 'Library', 'Application Support', 'ResumeStudio'))
  })

  it('honours XDG_DATA_HOME on Linux', () => {
    const xdg = path.join('/custom', 'xdg')
    const dir = defaultDataDir('linux', { XDG_DATA_HOME: xdg }, path.join('/home', 'me'))
    expect(dir).toBe(path.join(xdg, 'resume-studio'))
  })

  it('falls back to ~/.local/share/resume-studio on Linux without XDG_DATA_HOME', () => {
    const home = path.join('/home', 'me')
    const dir = defaultDataDir('linux', {}, home)
    expect(dir).toBe(path.join(home, '.local', 'share', 'resume-studio'))
  })
})

describe('resolvePaths', () => {
  const home = path.join('/home', 'me')
  const defaultDir = path.join(home, '.local', 'share', 'resume-studio')

  it('derives db + log under the default data dir', () => {
    const p = resolvePaths({}, 'linux', home)
    expect(p.dataDir).toBe(defaultDir)
    expect(p.dbPath).toBe(path.join(defaultDir, 'resume.db'))
    expect(p.logFile).toBe(path.join(defaultDir, 'resume-studio.log'))
    expect(p.backupDir).toBeNull()
  })

  it('RESUME_DATA_DIR overrides the data dir (and thus db + log)', () => {
    const custom = path.join('/data', 'rs')
    const p = resolvePaths({ RESUME_DATA_DIR: custom }, 'linux', home)
    expect(p.dataDir).toBe(custom)
    expect(p.dbPath).toBe(path.join(custom, 'resume.db'))
    expect(p.logFile).toBe(path.join(custom, 'resume-studio.log'))
  })

  it('RESUME_DB_PATH overrides only the db file, not the data dir', () => {
    const custom = path.join('/data', 'rs')
    const dbFile = path.join('/elsewhere', 'x.db')
    const p = resolvePaths({ RESUME_DATA_DIR: custom, RESUME_DB_PATH: dbFile }, 'linux', home)
    expect(p.dataDir).toBe(custom)
    expect(p.dbPath).toBe(dbFile)
  })

  it('RESUME_BACKUP_DIR is surfaced when set, null when blank', () => {
    const drive = path.join('/drive', 'rs')
    expect(resolvePaths({ RESUME_BACKUP_DIR: drive }, 'linux', home).backupDir).toBe(drive)
    expect(resolvePaths({ RESUME_BACKUP_DIR: '   ' }, 'linux', home).backupDir).toBeNull()
  })

  it('treats an empty RESUME_DATA_DIR as unset', () => {
    const p = resolvePaths({ RESUME_DATA_DIR: '  ' }, 'linux', home)
    expect(p.dataDir).toBe(defaultDir)
  })
})
