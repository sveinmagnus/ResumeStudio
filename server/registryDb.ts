/**
 * Instance-level registry store (cross-resume registries, Stage 3 / Increment 1).
 *
 * The CANONICAL half of the split in plans/cross-resume-registries.md §3.0: a
 * skill/role/industry/category's shared IDENTITY (localized name + normalized
 * key + skill-only classification/category link), owned by the instance rather
 * than any one resume, with its own optimistic-concurrency `version`. Per-person
 * facts (proficiency, experience, showcase highlight, per-resume ordering) are
 * NOT here — they stay on the resume.
 *
 * This module is ADDITIVE and not yet consumed by the client: it's the bedrock
 * the store-projection rewire (Increment 2) will build on. `promoteFromResumes`
 * is the read-only half of the one-time migration — it unions every resume's
 * existing registries into the canonical table WITHOUT touching resume data
 * (the reference-rewrite is Increment 2, landed together with the client so
 * `main` never breaks).
 *
 * Shares the caller's better-sqlite3 connection (createResumeDb wires it in), so
 * registry + resume writes can share a transaction later.
 */

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { skillKey, normalizeKey } from './skillKey.js'

export type RegistryKind = 'skill' | 'role' | 'industry' | 'category'
const KINDS: readonly RegistryKind[] = ['skill', 'role', 'industry', 'category']

/** A localized name, matching the client's `LocalizedString`. */
export type Localized = Record<string, string>

export interface RegistryEntry {
  id: string
  kind: RegistryKind
  name: Localized
  key: string
  /** Kind-specific canonical extras. Skill: `{ classification?, category_id? }`. Others: `{}`. */
  extra: Record<string, unknown>
  version: number
  updated_at: string
}

export interface RegistryUpsert {
  /** Omit to create; supply to update an existing entry. */
  id?: string
  kind: RegistryKind
  name: Localized
  extra?: Record<string, unknown>
  /** Optimistic-concurrency guard on UPDATE; ignored on create. */
  expectedVersion?: number
}

export type RegistryResult =
  | { ok: true; entry: RegistryEntry }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; current: RegistryEntry }

export interface PromoteSummary {
  /** New canonical entries created, per kind. */
  created: Record<RegistryKind, number>
  /** Existing entries whose localized name was extended, per kind. */
  merged: Record<RegistryKind, number>
}

/** The normalized dedup key for a name, per kind (skills get the "js" alias rule). */
export function registryKey(kind: RegistryKind, name: string): string {
  return kind === 'skill' ? skillKey(name) : normalizeKey(name)
}

/** Best key for a localized name: first non-empty key across its locales. */
function keyForLocalized(kind: RegistryKind, name: Localized): string {
  for (const v of Object.values(name)) {
    const k = registryKey(kind, v ?? '')
    if (k) return k
  }
  return ''
}

/** Merge localized b into a (a wins on conflict), returning a new object. */
function unionNames(a: Localized, b: Localized): Localized {
  const out: Localized = { ...a }
  for (const [loc, val] of Object.entries(b)) {
    if (!out[loc]?.trim() && (val ?? '').trim()) out[loc] = val
  }
  return out
}

interface Row {
  id: string; kind: string; name: string; key: string
  extra: string | null; version: number; updated_at: string
}

function rowToEntry(r: Row): RegistryEntry {
  return {
    id: r.id,
    kind: r.kind as RegistryKind,
    name: JSON.parse(r.name) as Localized,
    key: r.key,
    extra: r.extra ? (JSON.parse(r.extra) as Record<string, unknown>) : {},
    version: r.version,
    updated_at: r.updated_at,
  }
}

export interface RegistryStore {
  listRegistry(kind?: RegistryKind): RegistryEntry[]
  getRegistryEntry(id: string): RegistryEntry | null
  upsertRegistryEntry(input: RegistryUpsert): RegistryResult
  deleteRegistryEntry(id: string): boolean
  /**
   * Populate the canonical registry from a set of resume data blobs, unioning by
   * key. Read-only w.r.t. the resumes. Idempotent: re-running only extends
   * localized names, never duplicates. Returns per-kind created/merged counts.
   */
  promoteFromResumes(resumeDatas: unknown[]): PromoteSummary
}

/**
 * Create the registry table (idempotent) and return the registry operations
 * bound to `db`. Called by createResumeDb with its own connection.
 */
export function createRegistryStore(db: Database): RegistryStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_entries (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      name       TEXT NOT NULL,
      key        TEXT NOT NULL,
      extra      TEXT,
      version    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_kind_key
      ON registry_entries(kind, key);
  `)

  const selectAll = db.prepare('SELECT * FROM registry_entries ORDER BY kind, key')
  const selectByKind = db.prepare('SELECT * FROM registry_entries WHERE kind = ? ORDER BY key')
  const selectById = db.prepare('SELECT * FROM registry_entries WHERE id = ?')
  const selectByKindKey = db.prepare('SELECT * FROM registry_entries WHERE kind = ? AND key = ?')
  const insert = db.prepare(`
    INSERT INTO registry_entries (id, kind, name, key, extra, version, updated_at)
    VALUES (@id, @kind, @name, @key, @extra, 1, @updated_at)
  `)
  const update = db.prepare(`
    UPDATE registry_entries
       SET name = @name, key = @key, extra = @extra,
           version = version + 1, updated_at = @updated_at
     WHERE id = @id
  `)
  const del = db.prepare('DELETE FROM registry_entries WHERE id = ?')

  function listRegistry(kind?: RegistryKind): RegistryEntry[] {
    const rows = (kind ? selectByKind.all(kind) : selectAll.all()) as Row[]
    return rows.map(rowToEntry)
  }

  function getRegistryEntry(id: string): RegistryEntry | null {
    const row = selectById.get(id) as Row | undefined
    return row ? rowToEntry(row) : null
  }

  function upsertRegistryEntry(input: RegistryUpsert): RegistryResult {
    const now = new Date().toISOString()
    const key = keyForLocalized(input.kind, input.name)
    const extra = JSON.stringify(input.extra ?? {})

    if (input.id) {
      const existing = selectById.get(input.id) as Row | undefined
      if (!existing) return { ok: false, reason: 'not_found' }
      if (input.expectedVersion != null && existing.version !== input.expectedVersion) {
        return { ok: false, reason: 'conflict', current: rowToEntry(existing) }
      }
      update.run({ id: input.id, name: JSON.stringify(input.name), key, extra, updated_at: now })
      return { ok: true, entry: getRegistryEntry(input.id)! }
    }

    const id = randomUUID()
    insert.run({ id, kind: input.kind, name: JSON.stringify(input.name), key, extra, updated_at: now })
    return { ok: true, entry: getRegistryEntry(id)! }
  }

  function deleteRegistryEntry(id: string): boolean {
    return del.run(id).changes > 0
  }

  function promoteFromResumes(resumeDatas: unknown[]): PromoteSummary {
    const zero = (): Record<RegistryKind, number> => ({ skill: 0, role: 0, industry: 0, category: 0 })
    const summary: PromoteSummary = { created: zero(), merged: zero() }
    const now = new Date().toISOString()

    const promoteOne = (kind: RegistryKind, name: Localized) => {
      const key = keyForLocalized(kind, name)
      if (!key) return
      const existing = selectByKindKey.get(kind, key) as Row | undefined
      if (existing) {
        const merged = unionNames(JSON.parse(existing.name) as Localized, name)
        // Only write (and count) when the union actually added a locale.
        if (JSON.stringify(merged) !== existing.name) {
          update.run({ id: existing.id, name: JSON.stringify(merged), key, extra: existing.extra ?? '{}', updated_at: now })
          summary.merged[kind]++
        }
      } else {
        insert.run({ id: randomUUID(), kind, name: JSON.stringify(name), key, extra: '{}', updated_at: now })
        summary.created[kind]++
      }
    }

    const arraysFor: Record<RegistryKind, string> = {
      skill: 'skills', role: 'roles', industry: 'industries', category: 'skill_categories',
    }

    const run = db.transaction((datas: unknown[]) => {
      for (const data of datas) {
        if (!data || typeof data !== 'object') continue
        const store = data as Record<string, unknown>
        for (const kind of KINDS) {
          const arr = store[arraysFor[kind]]
          if (!Array.isArray(arr)) continue
          for (const item of arr) {
            const name = (item as { name?: unknown })?.name
            if (name && typeof name === 'object' && !Array.isArray(name)) {
              promoteOne(kind, name as Localized)
            }
          }
        }
      }
    })
    run(resumeDatas)
    return summary
  }

  return { listRegistry, getRegistryEntry, upsertRegistryEntry, deleteRegistryEntry, promoteFromResumes }
}
