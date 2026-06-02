/**
 * Local-first persistence — writes the active resume to localStorage as a
 * fallback so a server outage (or a closed laptop) never costs work.
 *
 * The cache is per-resume-id: each resume gets its own slot keyed by
 * `resumestudio:store-cache:v1:<id>`. This avoids two resumes fighting over
 * the same slot when the user switches.
 *
 * The cache is a fallback, not the source of truth: on app start the server
 * is queried first; the cache is only consulted if the server returned no
 * data OR was unreachable. When a fresh server load succeeds we replace the
 * cache with the server's copy so the two stay in sync.
 */

import type { ResumeStore } from '../types'

const PREFIX = 'resumestudio:store-cache:v1:'
const OLD_UNSCOPED_KEY = 'resumestudio:store-cache:v1'

interface CacheRecord {
  saved_at: string
  data: ResumeStore
}

function keyFor(resumeId: string): string {
  return `${PREFIX}${resumeId}`
}

/** Read the cached store for one resume id, or null if none/invalid. */
export function loadCache(resumeId: string): CacheRecord | null {
  try {
    const raw = localStorage.getItem(keyFor(resumeId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CacheRecord>
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null
    return {
      data: parsed.data as ResumeStore,
      saved_at: parsed.saved_at ?? new Date(0).toISOString(),
    }
  } catch (err) {
    console.warn('[localCache] could not read cache, ignoring:', err)
    return null
  }
}

/** Write the store + a timestamp for one resume id. Failures are logged. */
export function saveCache(resumeId: string, data: ResumeStore): void {
  try {
    const record: CacheRecord = { saved_at: new Date().toISOString(), data }
    localStorage.setItem(keyFor(resumeId), JSON.stringify(record))
  } catch (err) {
    // Quota exceeded or storage disabled. Non-fatal — the user just loses
    // the local fallback for this session.
    console.warn('[localCache] could not write cache:', err)
  }
}

/** Drop the cache for one resume. Call after a successful server sync. */
export function clearCache(resumeId: string): void {
  try {
    localStorage.removeItem(keyFor(resumeId))
  } catch {
    // ignore
  }
}

/** Drop every cached resume — used on token invalidation / logout. */
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
