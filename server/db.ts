import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { payloadStats } from './storage.js'
import {
  createRegistryStore, type RegistryStore,
} from './registryDb.js'

// See the note in app.ts: esbuild emits "" for import.meta.url in the desktop
// CJS bundle, so guard against fileURLToPath(""). DATA_DIR is only consulted
// when RESUME_DB_PATH is unset, which never happens in the desktop build (the
// launcher sets it), so the cwd-relative fallback there is moot.
const __dirname = import.meta.url
  ? path.dirname(fileURLToPath(import.meta.url))
  : process.cwd()
const DATA_DIR = path.join(__dirname, '..', 'data')

/** How many recent snapshots to retain per resume. Older ones are pruned on each save. */
export const MAX_SNAPSHOTS = 50

/**
 * Snapshots are *content* history — embedded base64 images (profile photo,
 * company logo, per-view overrides) would otherwise be duplicated into up to
 * MAX_SNAPSHOTS rows per resume (hundreds of kB each) and make image-only
 * edits churn history. Strip them from the snapshot copy; the live `resumes`
 * row always keeps the images, and the client re-attaches the current images
 * on restore (`src/lib/snapshotImages.ts`). Shallow-copies only the mutated
 * paths so the caller's object is never modified.
 */
function stripSnapshotImages(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data
  const d = { ...(data as Record<string, unknown>) }
  if (d.resume && typeof d.resume === 'object' && !Array.isArray(d.resume)) {
    const r = { ...(d.resume as Record<string, unknown>) }
    delete r.profile_photo
    delete r.company_logo
    d.resume = r
  }
  if (Array.isArray(d.views)) {
    d.views = d.views.map((v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return v
      const view = { ...(v as Record<string, unknown>) }
      if (view.header && typeof view.header === 'object' && !Array.isArray(view.header)) {
        const h = { ...(view.header as Record<string, unknown>) }
        delete h.photo_override
        delete h.logo_override
        view.header = h
      }
      return view
    })
  }
  return d
}

export interface ResumeMeta {
  id: string
  name: string
  primary_locale: string
  secondary_locale: string | null
  saved_at: string
  created_at: string
  /** Optimistic-concurrency token. Starts at 1, bumps by 1 on every save. */
  version: number
  /** Who last saved (named-token attribution, F10). Null = anonymous token / never saved. */
  saved_by: string | null
}

export interface ResumeFull {
  meta: ResumeMeta
  data: Record<string, unknown>
}

/**
 * A full resume row as it travels in a portable store-backup (see
 * `server/backup.ts`). Carries everything needed to recreate the row on another
 * machine — note there is no `version` field: optimistic-concurrency tokens are
 * per-machine sequences and meaningless across devices, so cross-machine
 * merging keys on `saved_at` instead.
 */
export interface ResumeBackupEntry {
  id: string
  name: string
  primary_locale: string
  secondary_locale: string | null
  saved_at: string
  created_at: string
  data: Record<string, unknown>
}

/** Outcome of a `restoreResumes` merge — one count per disposition. */
export interface RestoreSummary {
  inserted: number
  updated: number
  skipped: number
  deleted: number
}

export interface RestoreOptions {
  /**
   * 'merge' (default): union of local + incoming, newest `saved_at` wins per
   *   id; nothing is ever deleted. Safe for the multi-machine sync flow.
   * 'replace': as merge, but also deletes local resumes absent from the
   *   incoming set (snapshots cascade). Destructive — only for an explicit
   *   "make this machine match the backup" action.
   */
  mode?: 'merge' | 'replace'
}

/**
 * Outcome of a save attempt. `not-found` → the id is unknown; `conflict` →
 * the caller's `expectedVersion` was stale (someone else wrote in between) and
 * nothing was written — `current` is the live server state for diffing; `saved`
 * → written, with the new version.
 */
export type SaveResult =
  | { status: 'saved'; saved_at: string; version: number }
  | { status: 'conflict'; current: ResumeFull }
  | { status: 'not-found' }

export interface SnapshotMeta {
  id: number
  saved_at: string
  size: number
  /** Who made this save (named-token attribution, F10). */
  saved_by: string | null
}

/** Per-resume payload weight — the A4 "measure first" readout. */
export interface ResumeStorageStats {
  id: string
  name: string
  /** UTF-8 size of the live `data` JSON — what every auto-save PUT and localStorage pending record carries. */
  bytes: number
  /** Share of `bytes` held by embedded base64 images. */
  image_bytes: number
  snapshot_count: number
  /** Total bytes across this resume's (image-free) snapshots. */
  snapshot_bytes: number
}

export interface StorageStats {
  /** Size of the SQLite database (page_count × page_size). */
  db_bytes: number
  resumes: ResumeStorageStats[]
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

export interface ResumeDb extends RegistryStore {
  listResumes(): ResumeMeta[]
  createResume(input: CreateResumeInput): ResumeMeta
  getResume(id: string): ResumeFull | null
  /**
   * Replace `data` (and optionally locales) on an existing resume, bumping its
   * version. Appends a snapshot in the same transaction (deduped, pruned per
   * resume). If `expectedVersion` is supplied and no longer matches, nothing is
   * written and a `conflict` result is returned with the live server state.
   * Omit `expectedVersion` to force-write (used after the user resolves a
   * conflict "keep mine").
   */
  saveResume(
    id: string,
    data: unknown,
    locales?: LocaleUpdate,
    expectedVersion?: number,
    savedBy?: string | null,
  ): SaveResult
  deleteResume(id: string): boolean
  renameResume(id: string, name: string): boolean
  listSnapshots(resumeId: string): SnapshotMeta[]
  getSnapshot(resumeId: string, snapshotId: number): Record<string, unknown> | null
  /**
   * Per-resume payload weights (live JSON size, embedded-image share, snapshot
   * totals) plus the DB file size. Read-only measurement — scans every row, so
   * call it on demand (a picker load), not per save.
   */
  storageStats(): StorageStats
  /**
   * Every resume as portable backup entries, oldest-created first. The source
   * for a store-backup written to the sync folder.
   */
  dumpResumes(): ResumeBackupEntry[]
  /**
   * Merge a set of backup entries into this DB (see `RestoreOptions`). Runs in
   * a single transaction; appends a snapshot for each inserted/updated resume
   * so a surprising restore is itself reversible from History.
   */
  restoreResumes(entries: ResumeBackupEntry[], opts?: RestoreOptions): RestoreSummary
  /**
   * Checkpoint the WAL into the main DB file and close the connection. Call on
   * graceful shutdown so the `.db` file is self-contained at rest (important
   * when it — or its backup — lives in a cloud-synced folder). No-op-safe to
   * call once; the instance must not be used afterwards.
   */
  close(): void
}

/**
 * Build a resume store bound to `dbPath`. Each instance owns its own
 * connection and prepared statements. Pass ':memory:' for isolated tests;
 * production uses the lazy singleton below.
 */
export function createResumeDb(dbPath: string): ResumeDb {
  const db = new Database(dbPath)
  // WAL improves concurrent reads on a file DB; it's a no-op for ':memory:'.
  // It's the right default for the normal case (DB in a local app-data dir).
  // A power user who relocates the live DB into a cloud-synced folder should
  // set RESUME_DB_JOURNAL=TRUNCATE: WAL leaves long-lived -wal/-shm sidecars
  // that a sync client can upload at an inconsistent moment and corrupt the DB.
  // TRUNCATE keeps everything in the single .db file between transactions.
  const journal = (process.env.RESUME_DB_JOURNAL?.trim().toUpperCase() || 'WAL')
  const allowedJournal = new Set(['WAL', 'TRUNCATE', 'DELETE', 'PERSIST', 'MEMORY', 'OFF'])
  db.pragma(`journal_mode = ${allowedJournal.has(journal) ? journal : 'WAL'}`)
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
      created_at       TEXT NOT NULL,
      version          INTEGER NOT NULL DEFAULT 1,
      saved_by         TEXT
    );
    CREATE TABLE IF NOT EXISTS resume_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      resume_id  TEXT    NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      data       TEXT    NOT NULL,
      saved_at   TEXT    NOT NULL,
      saved_by   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_resume
      ON resume_snapshots(resume_id, id DESC);
  `)

  // Additive migration: a `resumes` table created before the offline-editing
  // work lacks the `version` column. `CREATE TABLE IF NOT EXISTS` won't add it
  // to an existing table, so patch it here. Unlike the multi-resume cleanup,
  // this must NOT drop data — real resumes may already live here. Existing rows
  // default to version 1 (any in-flight client sees a clean first save).
  const columns = db.prepare('PRAGMA table_info(resumes)').all() as { name: string }[]
  if (!columns.some((c) => c.name === 'version')) {
    db.exec('ALTER TABLE resumes ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
  }
  // Additive migration (F10): saved_by attribution on rows + snapshots.
  if (!columns.some((c) => c.name === 'saved_by')) {
    db.exec('ALTER TABLE resumes ADD COLUMN saved_by TEXT')
  }
  const snapColumns = db.prepare('PRAGMA table_info(resume_snapshots)').all() as { name: string }[]
  if (!snapColumns.some((c) => c.name === 'saved_by')) {
    db.exec('ALTER TABLE resume_snapshots ADD COLUMN saved_by TEXT')
  }

  // ─── Prepared statements ───────────────────────────────────────────────────
  const selectResumes = db.prepare(`
    SELECT id, name, primary_locale, secondary_locale, saved_at, created_at, version, saved_by
    FROM resumes
    ORDER BY saved_at DESC
  `)
  const selectResumeVersion = db.prepare('SELECT version FROM resumes WHERE id = ?')
  const selectResumeFull = db.prepare(`
    SELECT id, name, data, primary_locale, secondary_locale, saved_at, created_at, version, saved_by
    FROM resumes WHERE id = ?
  `)
  const insertResume = db.prepare(`
    INSERT INTO resumes (id, name, data, primary_locale, secondary_locale, saved_at, created_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `)
  const updateResumeData = db.prepare(`
    UPDATE resumes SET data = ?, saved_at = ?, saved_by = ?, version = version + 1 WHERE id = ?
  `)
  const updateResumeDataAndLocales = db.prepare(`
    UPDATE resumes
    SET data = ?, primary_locale = ?, secondary_locale = ?, saved_at = ?, saved_by = ?, version = version + 1
    WHERE id = ?
  `)
  const renameResumeStmt = db.prepare(`
    UPDATE resumes SET name = ? WHERE id = ?
  `)
  const deleteResumeStmt = db.prepare(`
    DELETE FROM resumes WHERE id = ?
  `)
  const selectAllFull = db.prepare(`
    SELECT id, name, data, primary_locale, secondary_locale, saved_at, created_at, version
    FROM resumes ORDER BY created_at ASC
  `)
  const selectAllIds = db.prepare('SELECT id FROM resumes')
  // Restore-only inserts/updates: they carry an explicit id + saved_at (taken
  // from the backup) rather than minting new ones, so a row keeps its identity
  // and timestamp across machines. New rows start at version 1; updates bump.
  const insertResumeWithId = db.prepare(`
    INSERT INTO resumes (id, name, data, primary_locale, secondary_locale, saved_at, created_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `)
  // saved_by is cleared on a restore-update: the content now comes from the
  // backup, not from whoever made the previous local edit.
  const updateResumeFromRestore = db.prepare(`
    UPDATE resumes
    SET name = ?, data = ?, primary_locale = ?, secondary_locale = ?, saved_at = ?, saved_by = NULL, version = version + 1
    WHERE id = ?
  `)

  const lastSnapshotData = db.prepare(`
    SELECT data FROM resume_snapshots
    WHERE resume_id = ? ORDER BY id DESC LIMIT 1
  `)
  const insertSnapshot = db.prepare(`
    INSERT INTO resume_snapshots (resume_id, data, saved_at, saved_by) VALUES (?, ?, ?, ?)
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
    SELECT id, saved_at, LENGTH(data) AS size, saved_by
    FROM resume_snapshots WHERE resume_id = ?
    ORDER BY id DESC
  `)
  const selectSnapshot = db.prepare(`
    SELECT data FROM resume_snapshots WHERE resume_id = ? AND id = ?
  `)
  const selectStorageRows = db.prepare(`
    SELECT id, name, data FROM resumes ORDER BY saved_at DESC
  `)
  // CAST AS BLOB so LENGTH counts bytes, not characters (TEXT LENGTH is chars).
  const selectSnapshotTotals = db.prepare(`
    SELECT resume_id, COUNT(*) AS count, SUM(LENGTH(CAST(data AS BLOB))) AS bytes
    FROM resume_snapshots GROUP BY resume_id
  `)

  // ─── Row coercion ─────────────────────────────────────────────────────────
  interface MetaRow {
    id: string
    name: string
    primary_locale: string
    secondary_locale: string | null
    saved_at: string
    created_at: string
    version: number
    saved_by: string | null
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
      version: 1,
      saved_by: null,
    }
  }

  const getResume = (id: string): ResumeFull | null => {
    const row = selectResumeFull.get(id) as FullRow | undefined
    if (!row) return null
    let data: Record<string, unknown>
    try {
      data = JSON.parse(row.data) as Record<string, unknown>
    } catch (err) {
      // A corrupt stored blob (e.g. after a bad cloud-folder sync) shouldn't
      // masquerade as "not found" — surface it so the API's error handler
      // returns a clean 500 rather than the client silently losing the resume.
      throw new Error(`Corrupt data for resume ${id}: ${(err as Error).message}`)
    }
    return {
      meta: {
        id: row.id,
        name: row.name,
        primary_locale: row.primary_locale,
        secondary_locale: row.secondary_locale,
        saved_at: row.saved_at,
        created_at: row.created_at,
        version: row.version,
        saved_by: row.saved_by,
      },
      data,
    }
  }

  /**
   * Persist resume JSON + optionally locales, bump the version, append a
   * snapshot (deduped), and prune to MAX_SNAPSHOTS — all in one transaction.
   * See the `ResumeDb.saveResume` doc for the conflict / not-found semantics.
   */
  const saveResume = (
    id: string,
    data: unknown,
    locales?: LocaleUpdate,
    expectedVersion?: number,
    savedBy?: string | null,
  ): SaveResult => {
    const row = selectResumeVersion.get(id) as { version: number } | undefined
    if (!row) return { status: 'not-found' }
    // Optimistic concurrency: a stale base version means someone wrote in
    // between. Write nothing; hand back the live state so the caller can diff.
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return { status: 'conflict', current: getResume(id)! }
    }
    const saved_at = new Date().toISOString()
    const by = savedBy ?? null
    const json = JSON.stringify(data)
    // Image-free copy for history. Comparing on the stripped JSON also means
    // an image-only change updates the live row without minting a snapshot.
    const snapJson = JSON.stringify(stripSnapshotImages(data))
    const newVersion = row.version + 1 // single synchronous connection → exact
    const tx = db.transaction(() => {
      if (locales) {
        updateResumeDataAndLocales.run(
          json, locales.primary_locale, locales.secondary_locale, saved_at, by, id,
        )
      } else {
        updateResumeData.run(json, saved_at, by, id)
      }
      const last = lastSnapshotData.get(id) as { data: string } | undefined
      if (!last || last.data !== snapJson) {
        insertSnapshot.run(id, snapJson, saved_at, by)
        pruneSnapshots.run(id, id, MAX_SNAPSHOTS)
      }
    })
    tx()
    return { status: 'saved', saved_at, version: newVersion }
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

  const storageStats = (): StorageStats => {
    const pageCount = db.pragma('page_count', { simple: true }) as number
    const pageSize = db.pragma('page_size', { simple: true }) as number
    const totals = new Map(
      (selectSnapshotTotals.all() as { resume_id: string; count: number; bytes: number | null }[])
        .map((r) => [r.resume_id, { count: r.count, bytes: r.bytes ?? 0 }]),
    )
    const resumes = (selectStorageRows.all() as { id: string; name: string; data: string }[])
      .map((row) => {
        const { bytes, image_bytes } = payloadStats(row.data)
        const snap = totals.get(row.id)
        return {
          id: row.id,
          name: row.name,
          bytes,
          image_bytes,
          snapshot_count: snap?.count ?? 0,
          snapshot_bytes: snap?.bytes ?? 0,
        }
      })
    return { db_bytes: pageCount * pageSize, resumes }
  }

  const dumpResumes = (): ResumeBackupEntry[] => {
    const out: ResumeBackupEntry[] = []
    for (const row of selectAllFull.all() as FullRow[]) {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(row.data) as Record<string, unknown>
      } catch (err) {
        // One corrupt row must not sink the whole backup / sync dump. Skip it
        // (a warning in the log) so the rest of the resumes still back up.
        console.warn(`[db] skipping resume ${row.id} in dump — corrupt data:`, (err as Error).message)
        continue
      }
      out.push({
        id: row.id,
        name: row.name,
        primary_locale: row.primary_locale,
        secondary_locale: row.secondary_locale,
        saved_at: row.saved_at,
        created_at: row.created_at,
        data,
      })
    }
    return out
  }

  const restoreResumes = (
    entries: ResumeBackupEntry[],
    opts?: RestoreOptions,
  ): RestoreSummary => {
    const summary: RestoreSummary = { inserted: 0, updated: 0, skipped: 0, deleted: 0 }
    const incomingIds = new Set(entries.map((e) => e.id))
    const snapshot = (id: string, json: string, savedAt: string) => {
      // Mirror saveResume's per-resume dedupe so an identical restore doesn't
      // pile up history. Restores carry no author → saved_by null.
      const last = lastSnapshotData.get(id) as { data: string } | undefined
      if (!last || last.data !== json) {
        insertSnapshot.run(id, json, savedAt, null)
        pruneSnapshots.run(id, id, MAX_SNAPSHOTS)
      }
    }
    const tx = db.transaction(() => {
      for (const e of entries) {
        const existing = selectResumeFull.get(e.id) as FullRow | undefined
        const json = JSON.stringify(e.data)
        const snapJson = JSON.stringify(stripSnapshotImages(e.data))
        if (!existing) {
          insertResumeWithId.run(
            e.id, e.name, json, e.primary_locale, e.secondary_locale, e.saved_at, e.created_at,
          )
          snapshot(e.id, snapJson, e.saved_at)
          summary.inserted++
          continue
        }
        // Newest-wins by saved_at (ISO-8601 UTC strings sort chronologically).
        // A tie or older incoming row, or identical content, is a no-op so the
        // merge converges without churning versions/snapshots/backups.
        if (e.saved_at <= existing.saved_at || existing.data === json) {
          summary.skipped++
          continue
        }
        updateResumeFromRestore.run(
          e.name, json, e.primary_locale, e.secondary_locale, e.saved_at, e.id,
        )
        snapshot(e.id, snapJson, e.saved_at)
        summary.updated++
      }
      if (opts?.mode === 'replace') {
        for (const { id } of selectAllIds.all() as { id: string }[]) {
          if (!incomingIds.has(id)) {
            deleteResumeStmt.run(id) // snapshots cascade
            summary.deleted++
          }
        }
      }
    })
    tx()
    return summary
  }

  const close = (): void => {
    // Fold the WAL back into the main file so the .db is self-contained at rest
    // (a no-op when not in WAL mode, e.g. ':memory:'). Best-effort: never let a
    // shutdown-time checkpoint failure mask the real exit.
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
    db.close()
  }

  // Instance-level registry (cross-resume registries, Increment 1). Shares this
  // connection; creates its own table. Additive — not yet consumed by the
  // resume save path (see plans/cross-resume-registries.md).
  const registry = createRegistryStore(db)

  return {
    listResumes, createResume, getResume, saveResume,
    deleteResume, renameResume, listSnapshots, getSnapshot,
    storageStats, dumpResumes, restoreResumes, close,
    ...registry,
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
  id: string, data: unknown, locales?: LocaleUpdate, expectedVersion?: number, savedBy?: string | null,
): SaveResult => defaultDb().saveResume(id, data, locales, expectedVersion, savedBy)
export const deleteResume = (id: string): boolean => defaultDb().deleteResume(id)
export const renameResume = (id: string, name: string): boolean => defaultDb().renameResume(id, name)
export const listSnapshots = (resumeId: string): SnapshotMeta[] => defaultDb().listSnapshots(resumeId)
export const getSnapshot = (
  resumeId: string, snapshotId: number,
): Record<string, unknown> | null => defaultDb().getSnapshot(resumeId, snapshotId)
export const storageStats = (): StorageStats => defaultDb().storageStats()
export const dumpResumes = (): ResumeBackupEntry[] => defaultDb().dumpResumes()
export const restoreResumes = (
  entries: ResumeBackupEntry[], opts?: RestoreOptions,
): RestoreSummary => defaultDb().restoreResumes(entries, opts)

// Instance registry (Increment 1) — singleton wrappers, like the resume ops.
export const listRegistry: RegistryStore['listRegistry'] = (kind) => defaultDb().listRegistry(kind)
export const getRegistryEntry: RegistryStore['getRegistryEntry'] = (id) => defaultDb().getRegistryEntry(id)
export const upsertRegistryEntry: RegistryStore['upsertRegistryEntry'] = (input) => defaultDb().upsertRegistryEntry(input)
export const deleteRegistryEntry: RegistryStore['deleteRegistryEntry'] = (id) => defaultDb().deleteRegistryEntry(id)
export const promoteFromResumes: RegistryStore['promoteFromResumes'] = (datas) => defaultDb().promoteFromResumes(datas)
export const mergeRegistry: RegistryStore['mergeRegistry'] = (entries) => defaultDb().mergeRegistry(entries)

/**
 * The shared singleton DB instance (same one the routes use). The desktop
 * launcher needs the real handle — not just the free-function wrappers — for
 * the boot-time restore, the backup scheduler, and `close()` on shutdown.
 */
export const getDefaultDb = (): ResumeDb => defaultDb()

/** Close + null the singleton so a fresh one is built on next use (shutdown). */
export const closeDefaultDb = (): void => {
  if (_default) {
    _default.close()
    _default = null
  }
}
