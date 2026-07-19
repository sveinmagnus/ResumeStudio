/**
 * Canonical-rename propagation (Stage 3 / Increment 2c).
 *
 * Mounted once while a resume is open (in `EditorRoute`). Watches the open
 * resume's LINKED registry entries and, when a shared entry is renamed,
 * debounce-pushes the new name to the instance-level canonical entry
 * (`api.updateRegistryEntry`) so every OTHER resume linking the same entry picks
 * it up on its next load (the boot overlay). A mini auto-save for shared names.
 *
 * Why this is safe:
 *  - It diffs against a baseline captured on mount, so simply OPENING a resume
 *    (whose names the boot overlay already reconciled FROM canonical) pushes
 *    nothing — only an actual edit does.
 *  - It carries the NAME only (see `linkedNameSnapshot`), never `category_id`.
 *  - Editing a NON-shared (unlinked) entry never touches the server.
 *
 * Conflict handling (Increment 4): the push carries the entry's `base_version`,
 * so a CONCURRENT rename of the same shared entry on another device is detected
 * (409 → `RegistryConflictError`) instead of blindly clobbered. On conflict the
 * server wins — the local name reconciles to the server's and a non-blocking
 * `registryNotice` tells the user their change wasn't applied. Versions are
 * seeded from the registry on mount and refreshed from each PUT response.
 */

import { useEffect, useRef } from 'react'
import { useStore } from './useStore'
import { api, RegistryConflictError } from '../lib/api'
import { linkedNameSnapshot } from '../lib/registrySync'
import type { LocalizedString } from '../types'

/** Debounce (ms) before a renamed shared entry is pushed to the canonical registry. */
const PUSH_DELAY = 800

/** A display name for a notice — first non-empty locale, else a generic word. */
function displayName(name: LocalizedString): string {
  return Object.values(name).find((v) => v?.trim()) || 'a shared entry'
}

export function useCanonicalRegistrySync(): void {
  const data = useStore((s) => s.data)
  const resumeId = useStore((s) => s.currentResumeId)
  const reconcileRegistry = useStore((s) => s.reconcileRegistry)
  const setRegistryNotice = useStore((s) => s.setRegistryNotice)
  // Baseline: canonicalId → serialized name, as last known to agree with the
  // server. `null` = not captured yet (first render for this resume).
  const baseline = useRef<Map<string, string> | null>(null)
  // canonicalId → last-known server version, for the optimistic-concurrency PUT.
  const versions = useRef<Map<string, number>>(new Map())

  // On resume change, reset the baseline and (re)load canonical versions so even
  // the FIRST rename push can carry a base_version and detect a concurrent edit.
  useEffect(() => {
    baseline.current = null
    let cancelled = false
    api.listRegistry()
      .then((entries) => { if (!cancelled) versions.current = new Map(entries.map((e) => [e.id, e.version])) })
      .catch(() => { /* offline / no server — pushes fall back to a forced write */ })
    return () => { cancelled = true }
  }, [resumeId])

  useEffect(() => {
    const snap = linkedNameSnapshot(data)

    // First pass for this resume: adopt the current linked names as the baseline
    // (the overlay already made them match canonical) and push nothing.
    if (baseline.current === null) {
      baseline.current = new Map([...snap].map(([id, name]) => [id, JSON.stringify(name)]))
      return
    }

    // Which shared entries changed name since the baseline?
    const changed: Array<{ id: string; name: LocalizedString }> = []
    for (const [id, name] of snap) {
      const ser = JSON.stringify(name)
      if (baseline.current.get(id) !== ser) changed.push({ id, name })
    }
    if (!changed.length) return

    const timer = setTimeout(() => {
      for (const { id, name } of changed) {
        api.updateRegistryEntry(id, { name, base_version: versions.current.get(id) })
          .then((entry) => {
            versions.current.set(id, entry.version)
            baseline.current?.set(id, JSON.stringify(name))
          })
          .catch((e) => {
            if (e instanceof RegistryConflictError && e.current) {
              // Server won: reconcile the local name to it, sync baseline +
              // version so we don't re-push, and surface a non-blocking notice.
              const cur = e.current
              reconcileRegistry([cur])
              versions.current.set(id, cur.version)
              baseline.current?.set(id, JSON.stringify(cur.name))
              setRegistryNotice(`"${displayName(name)}" is shared and was renamed on another device — your change wasn't applied.`)
            }
            // Other errors: leave un-synced; a later edit re-attempts.
          })
      }
    }, PUSH_DELAY)
    return () => clearTimeout(timer)
  }, [data, reconcileRegistry, setRegistryNotice])
}
