/**
 * PURE three-way merge for the whole-document save path.
 *
 * ## Why this exists
 *
 * Saves are whole-document PUTs guarded by an optimistic-concurrency `version`.
 * That makes concurrent editing SAFE (the second writer is refused rather than
 * clobbering), but it made it MISERABLE: any write from another tab, another
 * browser, or the desktop sync watcher refused our next save, and the conflict
 * modal then listed every difference between the two documents — including the
 * dozens of items neither session had actually touched. Reordering one section
 * renumbers `sort_order` on every item in it, so a single drag in one window
 * could present as "48 projects differ" in the other.
 *
 * A refusal is only a real conflict when BOTH sides changed the SAME value to
 * something different. Everything else has one unambiguous answer, and this
 * module computes it: the side that changed a value wins, the untouched side
 * yields, and the result is saved at the server's current version.
 *
 * ## The three inputs
 *
 * - `base`   — the document as it stood at the version our edits were derived
 *              from (the last thing this editor loaded or successfully saved).
 * - `mine`   — the in-memory document, including the edits the server refused.
 * - `theirs` — the server's current document.
 *
 * Without `base` there is no way to tell an edit from an untouched value, so
 * the caller falls back to the keep/discard modal. See `useResumePersistence`.
 *
 * ## The rules, in order, applied at every node
 *
 * 1. `mine` and `theirs` agree → that value; nothing to decide.
 * 2. `mine` equals `base` → only they changed it → take THEIRS.
 * 3. `theirs` equals `base` → only we changed it → take MINE.
 * 4. Both changed, and both are objects → recurse per key, so two people
 *    editing different FIELDS of the same project is not a conflict.
 * 5. Both changed, and both are arrays of `{ id }` items → merge by id, so two
 *    people editing different ITEMS of the same section is not a conflict.
 * 6. Otherwise → a genuine conflict. Recorded, and `mine` is kept in the merged
 *    output (which the caller discards anyway: a non-empty conflict list means
 *    the user decides).
 *
 * ## Array order is deliberately not merged
 *
 * Every sortable section displays by `sort_order` (`useSortedItems` → `sortItems`),
 * never by position in the JSON array — so the array's order is not user-visible
 * state and merging it would be inventing a conflict where none is observable.
 * The merged array follows the server's order with our own additions appended;
 * the `sort_order` FIELDS merge by the rules above, which is what the reader sees.
 */

import type { ResumeStore } from '../types'
import { labelOf } from './diffResume'

/** One value both sides changed differently — the only thing a human must resolve. */
export interface MergeConflict {
  /** Top-level store key the conflict sits under (`projects`, `resume`, …). */
  section: string
  /** Item id when the conflict is inside an identified array; null for the profile. */
  itemId: string | null
  /** Human-readable name of the item (or the section, when there is no item). */
  label: string
  /** Dotted field path within the item, e.g. `description.no`. Empty at item level. */
  field: string
  /** Display rendering of each side, for the modal. */
  mine: string
  theirs: string
}

export interface MergeResult {
  /** The reconciled document. Only trustworthy when `conflicts` is empty. */
  merged: ResumeStore
  /** Empty means the merge is unambiguous and can be applied without asking. */
  conflicts: MergeConflict[]
  /**
   * How many values were taken from the server copy — i.e. the size of the
   * other session's work we just absorbed. Zero means our save was refused over
   * changes that turned out to be entirely ours (a version bump with no content
   * difference); the merge is still correct, just uneventful.
   */
  adopted: number
}

// ─── Value helpers ───────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

interface Identified { id: string }

/**
 * An array we can merge element-wise: every element is an object carrying a
 * string `id`. An empty array qualifies (nothing to contradict it), which lets
 * "cleared on one side, appended on the other" merge instead of conflicting.
 */
function isIdentifiedArray(v: unknown): v is Identified[] {
  return Array.isArray(v) && v.every(
    (e) => isPlainObject(e) && typeof e.id === 'string',
  )
}

/**
 * Structural equality. Deliberately not `JSON.stringify` comparison: `theirs`
 * has been through a JSON round-trip and `mine` has not, so key insertion order
 * can differ between two documents that are semantically identical — and a
 * false "changed" here manufactures the exact spurious conflict this module
 * exists to remove.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    // Absent and explicitly-undefined are the same thing to us: a JSON round
    // trip drops undefined-valued keys, so treating them as different would
    // flag every optional field the server has seen.
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if (!deepEqual(a[k], b[k])) return false
    }
    return true
  }
  return false
}

/** Render any value as a short string for the conflict panel. */
function show(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`
  if (isPlainObject(v)) {
    // Localized strings are the common case here — show the first non-empty.
    for (const inner of Object.values(v)) {
      if (typeof inner === 'string' && inner.trim() !== '') return inner
    }
    return '(changed)'
  }
  return '(changed)'
}

// ─── Merge context ───────────────────────────────────────────────────────────

interface Ctx {
  section: string
  itemId: string | null
  label: string
  field: string[]
}

function withField(ctx: Ctx, key: string): Ctx {
  return { ...ctx, field: [...ctx.field, key] }
}

interface Acc {
  conflicts: MergeConflict[]
  adopted: number
}

function recordConflict(acc: Acc, ctx: Ctx, mine: unknown, theirs: unknown): void {
  acc.conflicts.push({
    section: ctx.section,
    itemId: ctx.itemId,
    label: ctx.label,
    field: ctx.field.join('.'),
    mine: show(mine),
    theirs: show(theirs),
  })
}

// ─── The recursion ───────────────────────────────────────────────────────────

function mergeValue(
  rawBase: unknown,
  rawMine: unknown,
  rawTheirs: unknown,
  ctx: Ctx,
  acc: Acc,
): unknown {
  // An optional section (`skill_categories`, `cover_letters`, anything added
  // since) is ABSENT in older data and `[]` in newer, and the two mean the same
  // thing. Without this, a document written by a build that predates a section
  // reads as "array vs nothing" — a type mismatch, which falls through to a
  // conflict the user cannot act on.
  const arrayish = isIdentifiedArray(rawMine) || isIdentifiedArray(rawTheirs)
  const base = arrayish && rawBase === undefined ? [] : rawBase
  const mine = arrayish && rawMine === undefined ? [] : rawMine
  const theirs = arrayish && rawTheirs === undefined ? [] : rawTheirs

  if (deepEqual(mine, theirs)) return mine
  if (deepEqual(base, mine)) { acc.adopted++; return theirs }
  if (deepEqual(base, theirs)) return mine

  if (isPlainObject(mine) && isPlainObject(theirs)) {
    const b = isPlainObject(base) ? base : {}
    const out: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const merged = mergeValue(b[key], mine[key], theirs[key], withField(ctx, key), acc)
      // Preserve deletion: an undefined result means neither side kept the key.
      if (merged !== undefined) out[key] = merged
    }
    return out
  }

  if (isIdentifiedArray(mine) && isIdentifiedArray(theirs)) {
    return mergeById(isIdentifiedArray(base) ? base : [], mine, theirs, ctx, acc)
  }

  recordConflict(acc, ctx, mine, theirs)
  return mine
}

/**
 * Merge two versions of an id-keyed collection.
 *
 * Add/add and edit/edit of *different* items merge silently. The two cases that
 * genuinely need a human are delete-vs-edit in either direction: one side threw
 * an item away while the other was still working on it, and neither answer is
 * safe to pick automatically.
 */
function mergeById(
  base: Identified[],
  mine: Identified[],
  theirs: Identified[],
  ctx: Ctx,
  acc: Acc,
): Identified[] {
  const byId = (arr: Identified[]) => new Map(arr.map((x) => [x.id, x]))
  const b = byId(base), m = byId(mine), t = byId(theirs)

  // Server order is the spine; our own additions follow. Display order comes
  // from `sort_order`, not from this sequence (see the module comment).
  const ids: string[] = [...theirs.map((x) => x.id)]
  for (const x of mine) if (!t.has(x.id)) ids.push(x.id)

  const out: Identified[] = []
  for (const id of ids) {
    const mineItem = m.get(id)
    const theirsItem = t.get(id)
    const baseItem = b.get(id)
    const itemCtx: Ctx = {
      ...ctx,
      itemId: id,
      label: labelOf(mineItem ?? theirsItem),
      field: [],
    }

    if (mineItem && theirsItem) {
      out.push(mergeValue(baseItem, mineItem, theirsItem, itemCtx, acc) as Identified)
      continue
    }

    if (mineItem && !theirsItem) {
      if (!baseItem) { out.push(mineItem); continue }        // we added it
      if (deepEqual(baseItem, mineItem)) { acc.adopted++; continue } // they deleted; we hadn't touched it
      // They deleted what we were editing.
      acc.conflicts.push({
        section: ctx.section, itemId: id, label: labelOf(mineItem), field: '',
        mine: 'edited here', theirs: 'deleted on the server',
      })
      out.push(mineItem)
      continue
    }

    if (!mineItem && theirsItem) {
      if (!baseItem) { acc.adopted++; out.push(theirsItem); continue } // they added it
      if (deepEqual(baseItem, theirsItem)) continue                    // we deleted; they hadn't touched it
      // We deleted what they were editing — keep theirs rather than silently
      // discarding someone else's work, and let the user decide.
      acc.conflicts.push({
        section: ctx.section, itemId: id, label: labelOf(theirsItem), field: '',
        mine: 'deleted here', theirs: 'edited on the server',
      })
      out.push(theirsItem)
    }
  }
  return out
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Reconcile our refused save against the server's current document.
 *
 * An empty `conflicts` list means `merged` is the correct next state and can be
 * saved without involving the user — that is the whole point: two people
 * working in different parts of the same CV should never be asked to choose.
 */
export function mergeStores(
  base: ResumeStore,
  mine: ResumeStore,
  theirs: ResumeStore,
): MergeResult {
  const acc: Acc = { conflicts: [], adopted: 0 }
  const keys = new Set([
    ...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs),
  ]) as Set<keyof ResumeStore>

  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const ctx: Ctx = { section: key, itemId: null, label: key, field: [] }
    const value = mergeValue(base[key], mine[key], theirs[key], ctx, acc)
    if (value !== undefined) merged[key] = value
  }

  return { merged: merged as unknown as ResumeStore, conflicts: acc.conflicts, adopted: acc.adopted }
}
