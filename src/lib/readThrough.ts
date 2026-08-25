/**
 * Read-through flags — the annotations behind the view editor's distraction-
 * free reading mode.
 *
 * Reading your own CV as a stranger would is a different activity from editing
 * it, and the reactions ("this is stale", "this undersells it") are worth more
 * than the reading. A flag captures one reaction against one item; the list
 * survives navigation — going off to FIX the first flag must not lose the
 * other four — so flags live in localStorage per (resume, view), not in
 * component state. Deliberately NOT in the resume store: a flag is a private
 * note-to-self about a reading session, and putting it in the store would
 * sync, snapshot and undo it.
 */

import { uuidv4 } from './uuid'

export interface ReadFlag {
  id: string
  /** Editor section of the flagged item, for "open in editor". */
  section: string
  /** The flagged item, or null for a view-level flag (the introduction). */
  itemId: string | null
  /** The item's display title, captured at flag time so the list stays legible. */
  label: string
  note: string
  created_at: string
}

const storageKey = (resumeId: string, viewId: string): string =>
  `resumestudio.readflags.${resumeId}.${viewId}`

/** Load a view's flags. Bad/absent storage reads as none. */
export function loadFlags(resumeId: string, viewId: string): ReadFlag[] {
  try {
    const raw = localStorage.getItem(storageKey(resumeId, viewId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f): f is ReadFlag =>
      !!f && typeof f === 'object'
      && typeof (f as ReadFlag).id === 'string'
      && typeof (f as ReadFlag).section === 'string'
      && typeof (f as ReadFlag).note === 'string')
  } catch {
    return []
  }
}

/** Persist a view's flags; an empty list removes the key. Best-effort. */
export function saveFlags(resumeId: string, viewId: string, flags: readonly ReadFlag[]): void {
  try {
    const key = storageKey(resumeId, viewId)
    if (!flags.length) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(flags))
  } catch {
    // Quota/privacy-mode failures lose nothing the resume owns.
  }
}

export function countFlags(resumeId: string, viewId: string): number {
  return loadFlags(resumeId, viewId).length
}

/** Add a flag (newest last). Pure over the list; id/timestamp injectable for tests. */
export function addFlag(
  flags: readonly ReadFlag[],
  flag: Pick<ReadFlag, 'section' | 'itemId' | 'label'> & { note?: string },
  now: Date = new Date(),
  idGen: () => string = uuidv4,
): ReadFlag[] {
  return [...flags, {
    id: idGen(),
    section: flag.section,
    itemId: flag.itemId,
    label: flag.label,
    note: flag.note ?? '',
    created_at: now.toISOString(),
  }]
}

export function removeFlag(flags: readonly ReadFlag[], id: string): ReadFlag[] {
  return flags.filter((f) => f.id !== id)
}

export function updateFlagNote(flags: readonly ReadFlag[], id: string, note: string): ReadFlag[] {
  return flags.map((f) => (f.id === id ? { ...f, note } : f))
}

/** Is this (section, item) already flagged? Drives the per-item flag toggle. */
export function findFlag(flags: readonly ReadFlag[], section: string, itemId: string | null): ReadFlag | undefined {
  return flags.find((f) => f.section === section && f.itemId === itemId)
}
