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
 *  - The PUT is unconditional (last-writer-wins) — fine for a small team; a
 *    failed push is simply retried on the next change.
 *  - Editing a NON-shared (unlinked) entry never touches the server.
 */

import { useEffect, useRef } from 'react'
import { useStore } from './useStore'
import { api } from '../lib/api'
import { linkedNameSnapshot } from '../lib/registrySync'

/** Debounce (ms) before a renamed shared entry is pushed to the canonical registry. */
const PUSH_DELAY = 800

export function useCanonicalRegistrySync(): void {
  const data = useStore((s) => s.data)
  const resumeId = useStore((s) => s.currentResumeId)
  // Baseline: canonicalId → serialized name, as last known to agree with the
  // server. `null` = not captured yet (first render for this resume).
  const baseline = useRef<Map<string, string> | null>(null)

  // Reset the baseline when the open resume changes — a different resume's links
  // are a different world; don't carry one's baseline into another.
  useEffect(() => { baseline.current = null }, [resumeId])

  useEffect(() => {
    const snap = linkedNameSnapshot(data)

    // First pass for this resume: adopt the current linked names as the baseline
    // (the overlay already made them match canonical) and push nothing.
    if (baseline.current === null) {
      baseline.current = new Map([...snap].map(([id, name]) => [id, JSON.stringify(name)]))
      return
    }

    // Which shared entries changed name since the baseline?
    const changed: Array<{ id: string; name: Record<string, string> }> = []
    for (const [id, name] of snap) {
      const ser = JSON.stringify(name)
      if (baseline.current.get(id) !== ser) changed.push({ id, name })
    }
    if (!changed.length) return

    const timer = setTimeout(() => {
      for (const { id, name } of changed) {
        api.updateRegistryEntry(id, { name })
          .then(() => { baseline.current?.set(id, JSON.stringify(name)) })
          .catch(() => { /* leave un-synced; a later edit re-attempts */ })
      }
    }, PUSH_DELAY)
    return () => clearTimeout(timer)
  }, [data])
}
