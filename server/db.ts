import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')

/** How many recent snapshots to retain per resume. Older ones are pruned on each save. */
export const MAX_SNAPSHOTS = 50

export interface ResumeMeta {
  id: string
  name: string
  primary_locale: string
  secondary_locale: string | null
  saved_at: string
  created_at: string
}

export interface ResumeFull {
  meta: ResumeMeta
  data: Record<string, unknown>
}

export interface SnapshotMeta {
  id: number
  saved_at: string
  size: number
}

export interface CreateResumeInput {
  name: string
  data?: unknown
  primary_locale?: string
  secondary_locale?: string | null
}

export interface LocaleUpdate {
  primary_locale: string
  secondary_locale: string | null
}

export interface ResumeDb {
  listResumes(): ResumeMeta[]
  createResume(input: CreateResumeInput): ResumeMeta
  getResume(id: string): ResumeFull | null
  /**
   * Replace `data` (and optionally locales) on an existing resume. Returns the
   * new `saved_at`, or null if no resume with that id exists. Appends a
   * snapshot in the same transaction (deduped, pruned per resume).
   */
  saveResume(id: string, data: unknown, locales?: LocaleUpdate): string | null
  deleteResume(id: string): boolean
  renameResume(id: string, name: string): boolean
  listSnapshots(resumeId: string): SnapshotMeta[]
  getSnapshot(resumeId: string, snapshotId: number): Record<string, unknown> | null
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
  // CASCADE on resume delete depends on this — SQLite default is OFF.
  db.pragma('foreign_keys = ON')

  // Lock the DB file to owner-only (0600). The file holds every resume in
  // plaintext; on a shared host a world-readable file leaks the lot. Best-
  // effort: skip ':memory:' (no file), and never let a chmod failure (e.g.
  // Windows, where it only toggles the read-only bit) stop the server. The
  // WAL/SHM sidecars inherit the *directory* mode — see defaultDb() below,
  // which tightens DATA_DIR to 0700.
  if (dbPath !== ':memory:') {
    try {
      fs.chmodSync(dbPath, 0o600)
    } catch (err) {
      console.warn(`[db] could not chmod ${dbPath} to 0600:`, err)
    }
  }

  // Defensive: nuke the pre-multi-resume schema so a stale dev DB can't
  // shadow the new tables. No production data exists yet; this is one-way.
  db.exec(`
    DROP TABLE IF EXISTS resume_store;
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS resumes (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      data             TEXT NOT NULL,
      primary_locale   TEXT NOT NULL DEFAULT 'en',
      secondary_locale TEXT,
      saved_at         TEXT NOT NULL,
      created_at       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resume_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      resume_id  TEXT    NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      data       TEXT    NOT NULL,
      saved_at   TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_resume
      ON resume_snapshots(resume_id, id DESC);
  `)

  // ─── Prepared statements ───────────────────────────────────────────────────
  const selectResumes = db.prepare(`
    SELECT id, name, primary_locale, secondary_locale, saved_at, created_at
    FROM resumes
    ORDER BY saved_at DESC
  `)
  const selectResumeMeta = db.prepare(`
    SELECT id, name, primary_locale, secondary_locale, saved_at, created_at
    FROM resumes WHERE id = ?
  `)
  const selectResumeFull = db.prepare(`
    SELECT id, name, data, primary_locale, secondary_locale, saved_at, created_at
    FROM resumes WHERE id = ?
  `)
  const insertResume = db.prepare(`
    INSERT INTO resumes (id, name, data, primary_locale, secondary_locale, saved_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updateResumeData = db.prepare(`
    UPDATE resumes SET data = ?, saved_at = ? WHERE id = ?
  `)
  const updateResumeDataAndLocales = db.prepare(`
    UPDATE resumes
    SET data = ?, primary_locale = ?, secondary_locale = ?, saved_at = ?
    WHERE id = ?
  `)
  const renameResumeStmt = db.prepare(`
    UPDATE resumes SET name = ? WHERE id = ?
  `)
  const deleteResumeStmt = db.prepare(`
    DELETE FROM resumes WHERE id = ?
  `)

  const lastSnapshotData = db.prepare(`
    SELECT data FROM resume_snapshots
    WHERE resume_id = ? ORDER BY id DESC LIMIT 1
  `)
  const insertSnapshot = db.prepare(`
    INSERT INTO resume_snapshots (resume_id, data, saved_at) VALUES (?, ?, ?)
  `)
  const pruneSnapshots = db.prepare(`
    DELETE FROM resume_snapshots
    WHERE resume_id = ?
      AND id NOT IN (
        SELECT id FROM resume_snapshots
        WHERE resume_id = ?
        ORDER BY id DESC LIMIT ?
      )
  `)
  const selectSnapshotList = db.prepare(`
    SELECT id, saved_at, LENGTH(data) AS size
    FROM resume_snapshots WHERE resume_id = ?
    ORDER BY id DESC
  `)
  const selectSnapshot = db.prepare(`
    SELECT data FROM resume_snapshots WHERE resume_id = ? AND id = ?
  `)

  // ─── Row coercion ─────────────────────────────────────────────────────────
  interface MetaRow {
    id: string
    name: string
    primary_locale: string
    secondary_locale: string | null
    saved_at: string
    created_at: string
  }
  interface FullRow extends MetaRow { data: string }

  // ─── Public API ───────────────────────────────────────────────────────────
  const listResumes = (): ResumeMeta[] => selectResumes.all() as ResumeMeta[]

  const createResume = (input: CreateResumeInput): ResumeMeta => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const json = JSON.stringify(input.data ?? {})
    const primary = input.primary_locale ?? 'en'
    const secondary = input.secondary_locale ?? null
    insertResume.run(id, input.name, json, primary, secondary, now, now)
    return {
      id,
      name: input.name,
      primary_locale: primary,
      secondary_locale: secondary,
      saved_at: now,
      created_at: now,
    }
  }

  const getResume = (id: string): ResumeFull | null => {
    const row = selectResumeFull.get(id) as FullRow | undefined
    if (!row) return null
    return {
      meta: {
        id: row.id,
        name: row.name,
        primary_locale: row.primary_locale,
        secondary_locale: row.secondary_locale,
        saved_at: row.saved_at,
        created_at: row.created_at,
      },
      data: JSON.parse(row.data) as Record<string, unknown>,
    }
  }

  /**
   * Persist resume JSON + optionally locales, append a snapshot (deduped),
   * and prune to MAX_SNAPSHOTS — all in one transaction. Returns null if the
   * resume id doesn't exist (caller maps to 404).
   */
  const saveResume = (
    id: string,
    data: unknown,
    locales?: LocaleUpdate,
  ): string | null => {
    if (!selectResumeMeta.get(id)) return null
    const saved_at = new Date().toISOString()
    const json = JSON.stringify(data)
    const tx = db.transaction(() => {
      if (locales) {
        updateResumeDataAndLocales.run(
          json, locales.primary_locale, locales.secondary_locale, saved_at, id,
        )
      } else {
        updateResumeData.run(json, saved_at, id)
      }
      const last = lastSnapshotData.get(id) as { data: string } | undefined
      if (!last || last.data !== json) {
        insertSnapshot.run(id, json, saved_at)
        pruneSnapshots.run(id, id, MAX_SNAPSHOTS)
      }
    })
    tx()
    return saved_at
  }

  const renameResume = (id: string, name: string): boolean => {
    const info = renameResumeStmt.run(name, id)
    return info.changes > 0
  }

  const deleteResume = (id: string): boolean => {
    const info = deleteResumeStmt.run(id)
    return info.changes > 0
  }

  const listSnapshots = (resumeId: string): SnapshotMeta[] =>
    selectSnapshotList.all(resumeId) as SnapshotMeta[]

  const getSnapshot = (
    resumeId: string,
    snapshotId: number,
  ): Record<string, unknown> | null => {
    const row = selectSnapshot.get(resumeId, snapshotId) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : null
  }

  return {
    listResumes, createResume, getResume, saveResume,
    deleteResume, renameResume, listSnapshots, getSnapshot,
  }
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
      // Owner-only directory (0700). This is what actually protects the
      // WAL/SHM sidecar files SQLite creates lazily — they inherit the dir
      // mode, not the main file's. Best-effort; chmod is a near-no-op on
      // Windows but harmless. Applied every boot so a pre-existing loose dir
      // gets tightened, not just a freshly-created one.
      try {
        fs.chmodSync(DATA_DIR, 0o700)
      } catch (err) {
        console.warn(`[db] could not chmod ${DATA_DIR} to 0700:`, err)
      }
      dbPath = path.join(DATA_DIR, 'resume.db')
    }
    _default = createResumeDb(dbPath)
  }
  return _default
}

export const listResumes = (): ResumeMeta[] => defaultDb().listResumes()
export const createResume = (input: CreateResumeInput): ResumeMeta => defaultDb().createResume(input)
export const getResume = (id: string): ResumeFull | null => defaultDb().getResume(id)
export const saveResume = (
  id: string, data: unknown, locales?: LocaleUpdate,
): string | null => defaultDb().saveResume(id, data, locales)
export const deleteResume = (id: string): boolean => defaultDb().deleteResume(id)
export const renameResume = (id: string, name: string): boolean => defaultDb().renameResume(id, name)
export const listSnapshots = (resumeId: string): SnapshotMeta[] => defaultDb().listSnapshots(resumeId)
export const getSnapshot = (
  resumeId: string, snapshotId: number,
): Record<string, unknown> | null => defaultDb().getSnapshot(resumeId, snapshotId)
