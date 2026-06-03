/**
 * Local-first persistence — a durable per-resume outbound queue.
 *
 * Each resume gets one slot in localStorage keyed `…:v1:<id>`, holding the
 * latest local edit plus the metadata needed to sync it safely:
 *   - `data` / `locales` — what to PUT.
 *   - `base_version`     — the server version this edit was derived from, so a
 *                          reconnect drain can do an optimistic-concurrency
 *                          check (stale base → 409 → conflict resolution).
 *   - `dirty`            — unsynced changes present. `listDirty()` enumerates
 *                          these for the reconnect drain and the unsaved guard.
 *   - `dirty_since`/`saved_at` — for the "N unsynced" / guard messaging.
 *
 * The queue is a fallback + an outbox, not the source of truth: on a successful
 * server sync the slot is cleared (`clearPending`). The model is whole-document
 * (one pending snapshot per resume), matching the PUT-wholesale save path — not
 * a per-field operation log.
 */

import type { ResumeStore } from '../types'

const PREFIX = 'resumestudio:store-cache:v1:'
const OLD_UNSCOPED_KEY = 'resumestudio:store-cache:v1'

export interface PendingLocales {
  primary: string
  secondary: string | null
}

export interface PendingRecord {
  data: ResumeStore
  locales: PendingLocales
  /** Server version this edit was derived from (optimistic-concurrency base). */
  base_version: number
  /** True while there are local changes the server hasn't acknowledged. */
  dirty: boolean
  /** ISO timestamp the record first went dirty (for "unsynced since…" UX). */
  dirty_since: string
  /** ISO timestamp of the last local write. */
  saved_at: string
}

export interface SavePendingInput {
  data: ResumeStore
  locales: PendingLocales
  base_version: number
  dirty: boolean
}

function keyFor(resumeId: string): string {
  return `${PREFIX}${resumeId}`
}

/**
 * Read the pending record for one resume id, or null if none/invalid.
 * Tolerates the pre-queue `{ saved_at, data }` shape by migrating it to a
 * clean (non-dirty) record — a legacy snapshot is a fallback, not a queued
 * edit, so it must not be force-flushed with guessed locales.
 */
export function loadPending(resumeId: string): PendingRecord | null {
  try {
    const raw = localStorage.getItem(keyFor(resumeId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingRecord> & { data?: ResumeStore }
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null
    const saved_at = parsed.saved_at ?? new Date(0).toISOString()
    return {
      data: parsed.data,
      locales: parsed.locales ?? { primary: 'en', secondary: null },
      base_version: typeof parsed.base_version === 'number' ? parsed.base_version : 0,
      dirty: parsed.dirty === true, // legacy records (no flag) are treated clean
      dirty_since: parsed.dirty_since ?? saved_at,
      saved_at,
    }
  } catch (err) {
    console.warn('[localCache] could not read pending record, ignoring:', err)
    return null
  }
}

/**
 * Write the pending record for one resume id. `dirty_since` is preserved across
 * successive dirty writes (so it reflects when the unsynced run began), and
 * reset when a record transitions clean→dirty. Failures are logged, not thrown.
 */
export function savePending(resumeId: string, input: SavePendingInput): void {
  try {
    const now = new Date().toISOString()
    const prev = loadPending(resumeId)
    const dirty_since = input.dirty
      ? (prev?.dirty ? prev.dirty_since : now) // keep the start of the dirty run
      : now
    const record: PendingRecord = {
      data: input.data,
      locales: input.locales,
      base_version: input.base_version,
      dirty: input.dirty,
      dirty_since,
      saved_at: now,
    }
    localStorage.setItem(keyFor(resumeId), JSON.stringify(record))
  } catch (err) {
    // Quota exceeded or storage disabled. Non-fatal — the user just loses the
    // local fallback for this session.
    console.warn('[localCache] could not write pending record:', err)
  }
}

/** Drop the pending record for one resume — call after a successful sync. */
export function clearPending(resumeId: string): void {
  try {
    localStorage.removeItem(keyFor(resumeId))
  } catch {
    // ignore
  }
}

/**
 * Every resume id with unsynced (dirty) edits, with when each went dirty.
 * Drives the reconnect drain set, the "N unsynced changes" indicator, and the
 * navigation/logout guard.
 */
export function listDirty(): { id: string; dirty_since: string }[] {
  const out: { id: string; dirty_since: string }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      const id = k.slice(PREFIX.length)
      const rec = loadPending(id)
      if (rec?.dirty) out.push({ id, dirty_since: rec.dirty_since })
    }
  } catch {
    // ignore — a best-effort enumeration
  }
  return out
}

/** Drop every cached resume — used on explicit logout / token invalidation. */
export function clearAllCaches(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}

/**
 * Drop the pre-multi-resume cache key. Called once on app boot — the old
 * key's content can't safely be attributed to any one resume id under the
 * new schema, so the safest thing is to forget it.
 */
export function dropLegacyCache(): void {
  try {
    localStorage.removeItem(OLD_UNSCOPED_KEY)
  } catch {
    // ignore
  }
}
