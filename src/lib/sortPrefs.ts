/**
 * Client-only persistence for a section's chosen SORT MODE (localStorage).
 *
 * The mode is a display preference, not resume data: it changes nothing in
 * `data`, so it must never ride the auto-save, the sync file, the snapshots or
 * the undo stack (same reasoning as `lib/readThrough.ts`'s annotations). But it
 * previously lived ONLY in Zustand memory, which meant every reload — and every
 * `loadStore`, so also a remote-update reload or a snapshot restore — silently
 * dropped the user back to Custom order. Picking "End date (newest)" and
 * finding Custom order on your next visit was that, not a bug in the sorting.
 *
 * Scoped per resume id: two CVs can legitimately want different orders, and a
 * shared key would let one person's choice surprise them in another document.
 *
 * The type filter is deliberately NOT persisted. It HIDES rows, and silently
 * restoring a filtered view days later — showing 2 of 40 courses with no memory
 * of having asked — is a worse failure than re-picking it.
 */

import type { SortMode } from '../types'
import { SORT_LABELS } from './sectionSort'
import { lookup } from './lookup'

const KEY_PREFIX = 'rs.sectionSort.'

/**
 * A stored value is only honoured if it is a mode this build still knows.
 *
 * Through `lookup`, not `SORT_LABELS[v]`: the value comes off localStorage, so
 * `'toString'` would otherwise read the inherited function and pass as a valid
 * mode. Every real mode has a non-empty label. See lib/lookup.ts.
 */
function isSortMode(v: unknown): v is SortMode {
  return typeof v === 'string' && lookup(SORT_LABELS, v, '') !== ''
}

/**
 * The saved sort modes for one resume, `{}` when there is nothing usable.
 *
 * Unknown sections and retired mode names are dropped rather than carried:
 * `sortItems` falls back to `sort_order` for a mode it cannot honour, so a
 * stale value would present as "my sort silently stopped working".
 */
export function loadSortPrefs(resumeId: string | null | undefined): Record<string, SortMode> {
  if (!resumeId) return {}
  try {
    const raw = localStorage.getItem(KEY_PREFIX + resumeId)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, SortMode> = {}
    // Own properties only: a stored `__proto__` key is an own property after
    // JSON.parse, and copying it wholesale is how junk reaches a live map.
    for (const [section, mode] of Object.entries(parsed as Record<string, unknown>)) {
      if (section !== '__proto__' && isSortMode(mode)) out[section] = mode
    }
    return out
  } catch {
    return {}
  }
}

/** Persist a resume's sort modes. Best-effort — storage may be unavailable. */
export function saveSortPrefs(
  resumeId: string | null | undefined, prefs: Record<string, SortMode>,
): void {
  if (!resumeId) return
  try {
    // 'custom' is the default, so storing it only grows the record.
    const keep = Object.fromEntries(
      Object.entries(prefs).filter(([, mode]) => mode !== 'custom'),
    )
    const key = KEY_PREFIX + resumeId
    if (Object.keys(keep).length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(keep))
  } catch { /* storage disabled or full */ }
}
