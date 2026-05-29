/**
 * Local-first persistence — writes the store to localStorage as a fallback,
 * so a server outage (or a closed laptop) never costs work.
 *
 * The cache is a fallback, not the source of truth: on app start the server
 * is queried first; the cache is only consulted if the server returned no
 * data OR was unreachable. When a fresh server load succeeds we replace the
 * cache with the server's copy so the two stay in sync.
 *
 * ~5 MB localStorage quota is comfortable for a typical resume (well under
 * 100 KB JSON). If the quota is ever exceeded we log and continue — losing
 * the local cache is non-fatal.
 *
 * Callers should debounce calls to `saveCache` to avoid stringifying the
 * whole store on every keystroke. App.tsx batches via a 250 ms timer.
 */

import type { ResumeStore } from '../types'

const KEY = 'resumestudio:store-cache:v1'

interface CacheRecord {
  saved_at: string
  data: ResumeStore
}

/** Read the cached store from localStorage, or null if none/invalid. */
export function loadCache(): CacheRecord | null {
  try {
    const raw = localStorage.getItem(KEY)
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

/** Write the store + a timestamp. Failures are logged and swallowed. */
export function saveCache(data: ResumeStore): void {
  try {
    const record: CacheRecord = { saved_at: new Date().toISOString(), data }
    localStorage.setItem(KEY, JSON.stringify(record))
  } catch (err) {
    // Quota exceeded or storage disabled (private mode in some browsers).
    // Not fatal — the user just loses the local fallback for this session.
    console.warn('[localCache] could not write cache:', err)
  }
}

/** Drop the cache — call after a successful server sync of a stale cache. */
export function clearCache(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
