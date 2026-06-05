/**
 * Whole-store backup format + sync helpers (server side).
 *
 * This is NOT the per-resume client backup in `src/lib/backup.ts` (that exports
 * one CV's internal store for the user to download). This is the *store* backup:
 * every resume in the DB, serialized to a single JSON file that the desktop
 * build writes into a cloud-synced folder so the data rides to other machines.
 *
 * Why a JSON file rather than syncing the SQLite DB itself: a live SQLite file
 * (plus its -wal/-shm sidecars) in a Dropbox/Drive/OneDrive folder is a known
 * corruption trap — the sync client uploads the pieces at inconsistent moments
 * and two machines can clobber each other. A plain JSON file is safe to sync;
 * the merge happens deterministically in `db.restoreResumes` (newest-wins per
 * resume by `saved_at`). See CLAUDE.md §8.
 *
 * Pure + filesystem helpers only — no Express, no DB handle. The route/launcher
 * layer wires these to the live DB.
 */

import fs from 'fs'
import path from 'path'
import type { ResumeBackupEntry } from './db.js'

/** Stable filename so the same file is overwritten/synced in place. */
export const BACKUP_FILENAME = 'resume-studio-backup.json'

export interface StoreBackupV1 {
  $schema: 'resumestudio-store/v1'
  format_version: 1
  exported_at: string
  generator: 'resume-studio'
  resumes: ResumeBackupEntry[]
}

/** Wrap the DB's resume dump in the versioned envelope. */
export function buildStoreBackup(entries: ResumeBackupEntry[]): StoreBackupV1 {
  return {
    $schema: 'resumestudio-store/v1',
    format_version: 1,
    exported_at: new Date().toISOString(),
    generator: 'resume-studio',
    resumes: entries,
  }
}

/** Lenient shape check — enough to reject a wrong/garbage file before parsing. */
export function isStoreBackup(json: unknown): json is StoreBackupV1 {
  if (!json || typeof json !== 'object') return false
  const obj = json as Record<string, unknown>
  return (
    typeof obj['$schema'] === 'string' &&
    String(obj['$schema']).startsWith('resumestudio-store/') &&
    typeof obj['format_version'] === 'number' &&
    Array.isArray(obj['resumes'])
  )
}

export class UnreadableBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnreadableBackupError'
  }
}

/**
 * Validate + narrow a parsed backup to its resume entries. Throws
 * `UnreadableBackupError` (with a user-safe message) on anything we can't read,
 * so callers surface a clear failure instead of a half-applied restore.
 */
export function parseStoreBackup(json: unknown): ResumeBackupEntry[] {
  if (!isStoreBackup(json)) {
    throw new UnreadableBackupError('Not a Resume Studio store backup file.')
  }
  if (json.format_version !== 1) {
    throw new UnreadableBackupError(
      `Unsupported backup format_version ${String(json.format_version)} ` +
      `— this build reads version 1. The file may be from a newer build.`,
    )
  }
  // Defensive per-row validation: a malformed entry would otherwise corrupt the
  // merge. Keep it cheap — just the fields the merge depends on.
  for (const e of json.resumes) {
    if (
      !e || typeof e !== 'object' ||
      typeof (e as ResumeBackupEntry).id !== 'string' ||
      typeof (e as ResumeBackupEntry).saved_at !== 'string' ||
      typeof (e as ResumeBackupEntry).data !== 'object'
    ) {
      throw new UnreadableBackupError('Backup file contains a malformed resume entry.')
    }
  }
  return json.resumes
}

/**
 * A content fingerprint of the store: id + saved_at per resume, order-independent.
 * Used to decide whether the on-disk backup is already up to date so the
 * scheduler/UI don't rewrite an unchanged file (avoids needless sync churn).
 */
export function backupSignature(entries: ResumeBackupEntry[]): string {
  return entries
    .map((e) => `${e.id}:${e.saved_at}`)
    .sort()
    .join('|')
}

export interface WriteResult {
  file: string
  bytes: number
}

/**
 * Atomically write the backup to `<dir>/resume-studio-backup.json`. Writes a
 * uniquely-named temp file in the same directory, fsyncs, then renames over the
 * target — so a sync client never observes a half-written file, and a crash
 * mid-write leaves the previous good backup intact. Creates `dir` if needed.
 */
export function writeBackupAtomic(dir: string, backup: StoreBackupV1): WriteResult {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, BACKUP_FILENAME)
  const json = JSON.stringify(backup, null, 2)
  const tmp = path.join(dir, `.${BACKUP_FILENAME}.${process.pid}.${Date.now()}.tmp`)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, json)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
  // Best-effort tighten perms — the file holds every CV in plaintext. No-op on
  // Windows (toggles read-only only) and never fatal.
  try { fs.chmodSync(file, 0o600) } catch { /* ignore */ }
  return { file, bytes: Buffer.byteLength(json) }
}

/** Read + parse the backup file in `dir`, or null if it doesn't exist. */
export function readBackupFile(dir: string): ResumeBackupEntry[] | null {
  const file = path.join(dir, BACKUP_FILENAME)
  if (!fs.existsSync(file)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new UnreadableBackupError('Backup file is not valid JSON.')
  }
  return parseStoreBackup(parsed)
}
