import { openDatabase } from './sqlite.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { payloadStats } from './storage.js'
import {
  createRegistryStore, type RegistryStore,
} from './registryDb.js'
import { createAccountsStore, type AccountsStore, type Viewer } from './accounts.js'
import {
  canRead, canWrite, canReshare, isUnrestricted, normaliseVisibility,
  readableWhere, writableWhere, type OwnedRow, type Visibility,
} from './access.js'

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
 * The viewer for work no request initiated: the backup scheduler, the folder
 * watcher, the desktop launcher's boot restore.
 *
 * They act for the machine rather than for a person, so they take the same
 * shape as a service credential — unrestricted, but owning nothing, which is
 * what keeps a resume merged in by a background sync unowned rather than
 * silently attributed to whoever happened to be signed in.
 */
export const SYSTEM_VIEWER: Viewer = { userId: null, role: 'owner', name: null }

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
  /**
   * The account that created it. Null for a service credential, the desktop
   * build, and rows that predate accounts — all of which read as owner-only
   * (`server/access.ts`).
   */
  owner_id: string | null
  /** Who else may read it. See `server/access.ts`. */
  visibility: Visibility
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
  /**
   * The owning account on the instance that wrote the file. Optional: files
   * written before accounts existed carry none, and one from another firm's
   * instance names an account that does not exist here. `restoreResumes`
   * honours it only for an unrestricted viewer, and only when the id resolves
   * to a real user — otherwise the importer becomes the owner.
   */
  owner_id?: string | null
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

/**
 * Storage, scoped.
 *
 * Every resume operation takes a `Viewer` as its FIRST argument, and it is
 * required rather than optional on purpose: a missed scope is a silent
 * cross-user data leak, so forgetting one has to be a compile error rather than
 * a runtime surprise. Same discipline as `mutate()` in the client store and
 * `src/lib/lookup.ts` for map reads — put the safe path where the unsafe one
 * used to be.
 *
 * The rules themselves live in `server/access.ts` and are not restated here.
 * Single-row operations read the row's `owner_id`/`visibility` and ask; list
 * operations take a WHERE fragment from `readableWhere`, which is null for an
 * unrestricted viewer so their queries stay exactly what they were.
 *
 * A row the viewer may not touch reports as ABSENT — `null`, `false`,
 * `not-found` — never as a distinct refusal, because a refusal would tell a
 * member which resume ids exist.
 */
export interface ResumeDb extends RegistryStore {
  /** Users, sessions, grants and recovery codes on this same connection. */
  accounts: AccountsStore
  listResumes(viewer: Viewer): ResumeMeta[]
  createResume(viewer: Viewer, input: CreateResumeInput): ResumeMeta
  getResume(viewer: Viewer, id: string): ResumeFull | null
  /**
   * Replace `data` (and optionally locales) on an existing resume, bumping its
   * version. Appends a snapshot in the same transaction (deduped, pruned per
   * resume). If `expectedVersion` is supplied and no longer matches, nothing is
   * written and a `conflict` result is returned with the live server state.
   * Omit `expectedVersion` to force-write (used after the user resolves a
   * conflict "keep mine").
   */
  saveResume(
    viewer: Viewer,
    id: string,
    data: unknown,
    locales?: LocaleUpdate,
    expectedVersion?: number,
    savedBy?: string | null,
  ): SaveResult
  deleteResume(viewer: Viewer, id: string): boolean
  renameResume(viewer: Viewer, id: string, name: string): boolean
  /** Change who else may read a resume. Only whoever may write it may reshare it. */
  setVisibility(viewer: Viewer, id: string, visibility: Visibility): boolean
  listSnapshots(viewer: Viewer, resumeId: string): SnapshotMeta[]
  getSnapshot(viewer: Viewer, resumeId: string, snapshotId: number): Record<string, unknown> | null
  /**
   * Per-resume payload weights (live JSON size, embedded-image share, snapshot
   * totals) plus the DB file size. Read-only measurement — scans every row, so
   * call it on demand (a picker load), not per save.
   */
  storageStats(viewer: Viewer): StorageStats
  /**
   * Every resume as portable backup entries, oldest-created first. The source
   * for a store-backup written to the sync folder.
   */
  dumpResumes(viewer: Viewer): ResumeBackupEntry[]
  /**
   * Merge a set of backup entries into this DB (see `RestoreOptions`). Runs in
   * a single transaction; appends a snapshot for each inserted/updated resume
   * so a surprising restore is itself reversible from History.
   *
   * An entry naming a resume the viewer may not write is counted as skipped:
   * merging by id is a write primitive, and an uploaded file must not become a
   * way to rewrite a colleague's CV.
   */
  restoreResumes(viewer: Viewer, entries: ResumeBackupEntry[], opts?: RestoreOptions): RestoreSummary
  /**
   * Give every ownerless resume to `userId`, returning how many moved. The
   * bootstrap's second half: on an upgrade those rows are the existing CVs, and
   * an unowned row is visible to nobody but an owner.
   */
  claimUnownedResumes(userId: string): number
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
  const db = openDatabase(dbPath)
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
      saved_by         TEXT,
      owner_id         TEXT,
      visibility       TEXT NOT NULL DEFAULT 'private'
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
  // Additive migration: ownership. Existing rows stay NULL — the bootstrap
  // hands them to the first account (`claimUnownedResumes`), and until it does
  // they read as owner-only rather than as everybody's.
  if (!columns.some((c) => c.name === 'owner_id')) {
    db.exec('ALTER TABLE resumes ADD COLUMN owner_id TEXT')
  }
  if (!columns.some((c) => c.name === 'visibility')) {
    db.exec("ALTER TABLE resumes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'")
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_resumes_owner ON resumes(owner_id)')

  // Accounts share this connection: `owner_id` points into `users`, and the two
  // have to be consistent within one transaction (the bootstrap creates the
  // first user and claims every unowned resume in one go).
  const accounts = createAccountsStore(db)
  const snapColumns = db.prepare('PRAGMA table_info(resume_snapshots)').all() as { name: string }[]
  if (!snapColumns.some((c) => c.name === 'saved_by')) {
    db.exec('ALTER TABLE resume_snapshots ADD COLUMN saved_by TEXT')
  }

  // ─── Prepared statements ───────────────────────────────────────────────────
  const META_COLS =
    'id, name, primary_locale, secondary_locale, saved_at, created_at, version, saved_by, owner_id, visibility'

  /**
   * Prepare-once cache for the scoped variants of a query.
   *
   * `readableWhere`/`writableWhere` return one fixed SQL fragment per rule, so
   * this holds a couple of statements for the whole process — but the fragment
   * is composed rather than constant, so it cannot be prepared up front beside
   * the others. Only the fragment is interpolated; the viewer's id is always a
   * bound parameter.
   */
  const scopedCache = new Map<string, ReturnType<typeof db.prepare>>()
  const scoped = (sql: string) => {
    let stmt = scopedCache.get(sql)
    if (!stmt) {
      stmt = db.prepare(sql)
      scopedCache.set(sql, stmt)
    }
    return stmt
  }

  const selectResumes = db.prepare(`
    SELECT ${META_COLS}
    FROM resumes
    ORDER BY saved_at DESC
  `)
  const selectResumeVersion = db.prepare(
    'SELECT version, owner_id, visibility FROM resumes WHERE id = ?',
  )
  const selectResumeAccess = db.prepare('SELECT owner_id, visibility FROM resumes WHERE id = ?')
  const selectResumeFull = db.prepare(`
    SELECT ${META_COLS}, data
    FROM resumes WHERE id = ?
  `)
  const insertResume = db.prepare(`
    INSERT INTO resumes (id, name, data, primary_locale, secondary_locale, saved_at, created_at, version, owner_id, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'private')
  `)
  const updateVisibility = db.prepare('UPDATE resumes SET visibility = ? WHERE id = ?')
  const claimUnowned = db.prepare('UPDATE resumes SET owner_id = ? WHERE owner_id IS NULL')
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
  const DUMP_COLS =
    'id, name, data, primary_locale, secondary_locale, saved_at, created_at, version, owner_id'
  const selectAllFull = db.prepare(`
    SELECT ${DUMP_COLS}
    FROM resumes ORDER BY created_at ASC
  `)
  const selectAllIds = db.prepare('SELECT id FROM resumes')
  // Restore-only inserts/updates: they carry an explicit id + saved_at (taken
  // from the backup) rather than minting new ones, so a row keeps its identity
  // and timestamp across machines. New rows start at version 1; updates bump.
  const insertResumeWithId = db.prepare(`
    INSERT INTO resumes (id, name, data, primary_locale, secondary_locale, saved_at, created_at, version, owner_id, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'private')
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
    owner_id: string | null
    visibility: string
  }
  interface FullRow extends MetaRow { data: string }
  interface DumpRow extends Omit<MetaRow, 'saved_by' | 'visibility'> { data: string }

  /** The row's access columns, or null when there is no such resume. */
  const accessOf = (id: string): OwnedRow | null =>
    (selectResumeAccess.get(id) as OwnedRow | undefined) ?? null

  const metaOf = (row: MetaRow): ResumeMeta => ({
    id: row.id,
    name: row.name,
    primary_locale: row.primary_locale,
    secondary_locale: row.secondary_locale,
    saved_at: row.saved_at,
    created_at: row.created_at,
    version: row.version,
    saved_by: row.saved_by,
    owner_id: row.owner_id,
    visibility: normaliseVisibility(row.visibility),
  })

  // ─── Public API ───────────────────────────────────────────────────────────
  const listResumes = (viewer: Viewer): ResumeMeta[] => {
    const where = readableWhere(viewer)
    const rows = where
      ? scoped(`SELECT ${META_COLS} FROM resumes WHERE ${where.sql} ORDER BY saved_at DESC`)
        .all(...where.params) as MetaRow[]
      : selectResumes.all() as MetaRow[]
    return rows.map(metaOf)
  }

  const createResume = (viewer: Viewer, input: CreateResumeInput): ResumeMeta => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const json = JSON.stringify(input.data ?? {})
    const primary = input.primary_locale ?? 'en'
    const secondary = input.secondary_locale ?? null
    insertResume.run(id, input.name, json, primary, secondary, now, now, viewer.userId)
    return {
      id,
      name: input.name,
      primary_locale: primary,
      secondary_locale: secondary,
      saved_at: now,
      created_at: now,
      version: 1,
      saved_by: null,
      owner_id: viewer.userId,
      visibility: 'private',
    }
  }

  const getResume = (viewer: Viewer, id: string): ResumeFull | null => {
    const row = selectResumeFull.get(id) as FullRow | undefined
    if (!row) return null
    if (!canRead(viewer, row)) return null
    let data: Record<string, unknown>
    try {
      data = JSON.parse(row.data) as Record<string, unknown>
    } catch (err) {
      // A corrupt stored blob (e.g. after a bad cloud-folder sync) shouldn't
      // masquerade as "not found" — surface it so the API's error handler
      // returns a clean 500 rather than the client silently losing the resume.
      throw new Error(`Corrupt data for resume ${id}: ${(err as Error).message}`, { cause: err })
    }
    return { meta: metaOf(row), data }
  }

  /**
   * Persist resume JSON + optionally locales, bump the version, append a
   * snapshot (deduped), and prune to MAX_SNAPSHOTS — all in one transaction.
   * See the `ResumeDb.saveResume` doc for the conflict / not-found semantics.
   */
  const saveResume = (
    viewer: Viewer,
    id: string,
    data: unknown,
    locales?: LocaleUpdate,
    expectedVersion?: number,
    savedBy?: string | null,
  ): SaveResult => {
    const row = selectResumeVersion.get(id) as
      | (OwnedRow & { version: number })
      | undefined
    if (!row) return { status: 'not-found' }
    // A resume this viewer may not change reports as absent rather than
    // refused: `SaveResult` has no third status, and of the two existing ones
    // "not found" is the one that answers nothing about which ids exist.
    if (!canWrite(viewer, row)) return { status: 'not-found' }
    // Optimistic concurrency: a stale base version means someone wrote in
    // between. Write nothing; hand back the live state so the caller can diff.
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return { status: 'conflict', current: getResume(viewer, id)! }
    }
    const saved_at = new Date().toISOString()
    const by = savedBy ?? null
    const json = JSON.stringify(data)
    // Image-free copy for history. Comparing on the stripped JSON also means
    // an image-only change updates the live row without minting a snapshot.
    const snapJson = JSON.stringify(stripSnapshotImages(data))
    // Exact rather than optimistic: node:sqlite is one synchronous connection,
    // so no other write can land between this read and the UPDATE below.
    const newVersion = row.version + 1
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

  const renameResume = (viewer: Viewer, id: string, name: string): boolean => {
    const row = accessOf(id)
    if (!row || !canWrite(viewer, row)) return false
    return renameResumeStmt.run(name, id).changes > 0
  }

  const deleteResume = (viewer: Viewer, id: string): boolean => {
    const row = accessOf(id)
    if (!row || !canWrite(viewer, row)) return false
    return deleteResumeStmt.run(id).changes > 0
  }

  const setVisibility = (viewer: Viewer, id: string, visibility: Visibility): boolean => {
    const row = accessOf(id)
    if (!row || !canReshare(viewer, row)) return false
    return updateVisibility.run(normaliseVisibility(visibility), id).changes > 0
  }

  const listSnapshots = (viewer: Viewer, resumeId: string): SnapshotMeta[] => {
    const row = accessOf(resumeId)
    if (!row || !canRead(viewer, row)) return []
    return selectSnapshotList.all(resumeId) as SnapshotMeta[]
  }

  const getSnapshot = (
    viewer: Viewer,
    resumeId: string,
    snapshotId: number,
  ): Record<string, unknown> | null => {
    const owner = accessOf(resumeId)
    if (!owner || !canRead(viewer, owner)) return null
    const row = selectSnapshot.get(resumeId, snapshotId) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : null
  }

  const storageStats = (viewer: Viewer): StorageStats => {
    const pageCount = db.pragma('page_count', { simple: true }) as number
    const pageSize = db.pragma('page_size', { simple: true }) as number
    const totals = new Map(
      (selectSnapshotTotals.all() as { resume_id: string; count: number; bytes: number | null }[])
        .map((r) => [r.resume_id, { count: r.count, bytes: r.bytes ?? 0 }]),
    )
    const where = readableWhere(viewer)
    const rows = where
      ? scoped(`SELECT id, name, data FROM resumes WHERE ${where.sql} ORDER BY saved_at DESC`)
        .all(...where.params)
      : selectStorageRows.all()
    const resumes = (rows as { id: string; name: string; data: string }[])
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

  const dumpResumes = (viewer: Viewer): ResumeBackupEntry[] => {
    const where = readableWhere(viewer)
    const rows = where
      ? scoped(`SELECT ${DUMP_COLS} FROM resumes WHERE ${where.sql} ORDER BY created_at ASC`)
        .all(...where.params)
      : selectAllFull.all()
    const out: ResumeBackupEntry[] = []
    for (const row of rows as DumpRow[]) {
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
        owner_id: row.owner_id,
        data,
      })
    }
    return out
  }

  /**
   * Who a restored row belongs to.
   *
   * The importer, normally: a file carries no proof of who wrote it, and the
   * person who chose to import it is the one accountable for it being here. An
   * owner restoring a whole instance is the exception — there, the file's own
   * `owner_id` is the record of who each CV belonged to, and collapsing fifty
   * people's resumes onto the administrator who ran the restore would destroy
   * that. Honoured only when the id resolves to a user of THIS instance, so a
   * file from elsewhere cannot name an account that does not exist.
   */
  const restoreOwner = (viewer: Viewer, entry: ResumeBackupEntry): string | null => {
    const carried = entry.owner_id
    if (isUnrestricted(viewer) && typeof carried === 'string' && accounts.getUser(carried)) {
      return carried
    }
    return viewer.userId
  }

  const restoreResumes = (
    viewer: Viewer,
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
            restoreOwner(viewer, e),
          )
          snapshot(e.id, snapJson, e.saved_at)
          summary.inserted++
          continue
        }
        // Merging by id is a write, so an entry naming a resume this viewer may
        // not change is skipped — otherwise uploading a file would be a way to
        // rewrite a colleague's CV, or to learn whose ids exist by watching the
        // counts. Ownership of an existing row is never reassigned by a merge.
        if (!canWrite(viewer, existing)) {
          summary.skipped++
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
        // "Make this machine match the backup" can only mean the part of the
        // machine this viewer speaks for; a member's replace must not sweep away
        // resumes they cannot even see.
        const where = writableWhere(viewer)
        const rows = where
          ? scoped(`SELECT id FROM resumes WHERE ${where.sql}`).all(...where.params)
          : selectAllIds.all()
        for (const { id } of rows as { id: string }[]) {
          if (!incomingIds.has(id)) {
            // Snapshots go with it — the FK is ON DELETE CASCADE.
            deleteResumeStmt.run(id)
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

  const claimUnownedResumes = (userId: string): number => claimUnowned.run(userId).changes

  // Instance-level registry (cross-resume registries, Increment 1). Shares this
  // connection; creates its own table. Additive — not yet consumed by the
  // resume save path (see server/registryDb.ts and CLAUDE.md §14).
  const registry = createRegistryStore(db)

  return {
    accounts,
    listResumes, createResume, getResume, saveResume,
    deleteResume, renameResume, setVisibility, listSnapshots, getSnapshot,
    storageStats, dumpResumes, restoreResumes, claimUnownedResumes, close,
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

export const listResumes = (viewer: Viewer): ResumeMeta[] => defaultDb().listResumes(viewer)
export const createResume = (viewer: Viewer, input: CreateResumeInput): ResumeMeta =>
  defaultDb().createResume(viewer, input)
export const getResume = (viewer: Viewer, id: string): ResumeFull | null =>
  defaultDb().getResume(viewer, id)
export const saveResume = (
  viewer: Viewer, id: string, data: unknown, locales?: LocaleUpdate, expectedVersion?: number,
  savedBy?: string | null,
): SaveResult => defaultDb().saveResume(viewer, id, data, locales, expectedVersion, savedBy)
export const deleteResume = (viewer: Viewer, id: string): boolean =>
  defaultDb().deleteResume(viewer, id)
export const renameResume = (viewer: Viewer, id: string, name: string): boolean =>
  defaultDb().renameResume(viewer, id, name)
export const setVisibility = (viewer: Viewer, id: string, visibility: Visibility): boolean =>
  defaultDb().setVisibility(viewer, id, visibility)
export const listSnapshots = (viewer: Viewer, resumeId: string): SnapshotMeta[] =>
  defaultDb().listSnapshots(viewer, resumeId)
export const getSnapshot = (
  viewer: Viewer, resumeId: string, snapshotId: number,
): Record<string, unknown> | null => defaultDb().getSnapshot(viewer, resumeId, snapshotId)
export const storageStats = (viewer: Viewer): StorageStats => defaultDb().storageStats(viewer)
export const dumpResumes = (viewer: Viewer): ResumeBackupEntry[] => defaultDb().dumpResumes(viewer)
export const restoreResumes = (
  viewer: Viewer, entries: ResumeBackupEntry[], opts?: RestoreOptions,
): RestoreSummary => defaultDb().restoreResumes(viewer, entries, opts)

/** The accounts store on the default connection — what `routes/auth.ts` signs people in against. */
export const getAccounts = (): AccountsStore => defaultDb().accounts
export const claimUnownedResumes = (userId: string): number =>
  defaultDb().claimUnownedResumes(userId)

// Instance registry (Increment 1) — singleton wrappers, like the resume ops.
export const listRegistry: RegistryStore['listRegistry'] = (kind) => defaultDb().listRegistry(kind)
export const getRegistryEntry: RegistryStore['getRegistryEntry'] = (id) => defaultDb().getRegistryEntry(id)
export const upsertRegistryEntry: RegistryStore['upsertRegistryEntry'] = (input) => defaultDb().upsertRegistryEntry(input)
export const deleteRegistryEntry: RegistryStore['deleteRegistryEntry'] = (id) => defaultDb().deleteRegistryEntry(id)
export const promoteFromResumes: RegistryStore['promoteFromResumes'] = (datas) => defaultDb().promoteFromResumes(datas)
export const mergeRegistry: RegistryStore['mergeRegistry'] = (entries) => defaultDb().mergeRegistry(entries)

/**
 * Is this the failure of a DAMAGED database file, rather than an ordinary
 * error?
 *
 * SQLite reports the whole class as plain `Error`, so the message is the only
 * discriminator available. Pure and exported so the classification is testable
 * without corrupting a file, and so the launcher can tell the one failure a
 * user cannot act on ("something threw") from the one they can ("the file at
 * this path is damaged; your data is in the sync folder").
 *
 * Deliberately narrow. A missing directory, a permissions problem or a locked
 * file are NOT this: they are fixable in place and must keep their own errors.
 */
export function isCorruptDbError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : ''
  return (
    message.includes('file is not a database') ||
    message.includes('disk image is malformed') ||
    message.includes('database corruption') ||
    message.includes('malformed database schema')
  )
}

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
