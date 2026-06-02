import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')

/** How many recent snapshots to retain. Older ones are pruned on each save. */
export const MAX_SNAPSHOTS = 50

export interface StoredRow {
  data: string
  saved_at: string
}

export interface SnapshotMeta {
  id: number
  saved_at: string
  size: number
}

export interface ResumeDb {
  getResume(): Record<string, unknown> | null
  saveResume(data: unknown): string
  getLastSavedAt(): string | null
  listSnapshots(): SnapshotMeta[]
  getSnapshot(id: number): Record<string, unknown> | null
}

/**
 * Build a resume store bound to `dbPath`. Each instance owns its own
 * connection and prepared statements. Pass ':memory:' for isolated tests;
 * production uses the lazy singleton below.
 */
export function createResumeDb(dbPath: string): ResumeDb {
  const db = new Database(dbPath)
  // WAL improves concurrent reads on a file DB; it's a no-op for ':memory:'.
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS resume_store (
      id       INTEGER PRIMARY KEY CHECK (id = 1),
      data     TEXT    NOT NULL,
      saved_at TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resume_snapshots (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      data     TEXT    NOT NULL,
      saved_at TEXT    NOT NULL
    );
  `)

  const upsertMain = db.prepare(`
    INSERT INTO resume_store (id, data, saved_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at
  `)
  const selectMain = db.prepare('SELECT data FROM resume_store WHERE id = 1')
  const selectSavedAt = db.prepare('SELECT saved_at FROM resume_store WHERE id = 1')
  const lastSnapshotData = db.prepare('SELECT data FROM resume_snapshots ORDER BY id DESC LIMIT 1')
  const insertSnapshot = db.prepare('INSERT INTO resume_snapshots (data, saved_at) VALUES (?, ?)')
  const pruneSnapshots = db.prepare(`
    DELETE FROM resume_snapshots
    WHERE id NOT IN (SELECT id FROM resume_snapshots ORDER BY id DESC LIMIT ?)
  `)
  const selectSnapshotList = db.prepare(
    'SELECT id, saved_at, LENGTH(data) AS size FROM resume_snapshots ORDER BY id DESC',
  )
  const selectSnapshot = db.prepare('SELECT data FROM resume_snapshots WHERE id = ?')

  /**
   * Persist the resume JSON (single row) and append a snapshot, in one
   * transaction so the live row and the snapshot log never diverge. A snapshot
   * identical to the most recent one is skipped (de-dup); the log is pruned to
   * the newest MAX_SNAPSHOTS entries.
   */
  const saveResume = (data: unknown): string => {
    const saved_at = new Date().toISOString()
    const json = JSON.stringify(data)
    const tx = db.transaction(() => {
      upsertMain.run(json, saved_at)
      const last = lastSnapshotData.get() as { data: string } | undefined
      if (!last || last.data !== json) {
        insertSnapshot.run(json, saved_at)
        pruneSnapshots.run(MAX_SNAPSHOTS)
      }
    })
    tx()
    return saved_at
  }

  const getResume = (): Record<string, unknown> | null => {
    const row = selectMain.get() as StoredRow | undefined
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : null
  }

  const getLastSavedAt = (): string | null => {
    const row = selectSavedAt.get() as StoredRow | undefined
    return row?.saved_at ?? null
  }

  const listSnapshots = (): SnapshotMeta[] => selectSnapshotList.all() as SnapshotMeta[]

  const getSnapshot = (id: number): Record<string, unknown> | null => {
    const row = selectSnapshot.get(id) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : null
  }

  return { getResume, saveResume, getLastSavedAt, listSnapshots, getSnapshot }
}

// ─── Lazy default singleton (production) ───────────────────────────────────
// Built on first use, not at import time, so merely importing this module
// (e.g. in a test) opens no database. Honors RESUME_DB_PATH for tests/ops.

let _default: ResumeDb | null = null

function defaultDb(): ResumeDb {
  if (!_default) {
    const envPath = process.env.RESUME_DB_PATH?.trim()
    let dbPath: string
    if (envPath) {
      dbPath = envPath
    } else {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
      dbPath = path.join(DATA_DIR, 'resume.db')
    }
    _default = createResumeDb(dbPath)
  }
  return _default
}

export const getResume = (): Record<string, unknown> | null => defaultDb().getResume()
export const saveResume = (data: unknown): string => defaultDb().saveResume(data)
export const getLastSavedAt = (): string | null => defaultDb().getLastSavedAt()
export const listSnapshots = (): SnapshotMeta[] => defaultDb().listSnapshots()
export const getSnapshot = (id: number): Record<string, unknown> | null => defaultDb().getSnapshot(id)
