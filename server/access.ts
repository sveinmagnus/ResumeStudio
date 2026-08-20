/**
 * Who may see and change which resume. The ONE place that answers it.
 *
 * This is deliberately a tiny pure module rather than a WHERE clause repeated
 * across eleven query sites, for the same reason `src/lib/lookup.ts` exists: a
 * rule spread across eleven call sites is a rule that will eventually be
 * written ten times. Here it is written once, unit-tested against a table, and
 * the query layer asks rather than remembers.
 *
 * THE MODEL (plan Phase 2):
 *
 *  - **owner** sees and changes everything. Needed to run backups, to staff
 *    work across the firm, and to recover a departed colleague's CV.
 *  - **member** owns what they created: full read and write. They may READ a
 *    resume marked `visibility: 'instance'`, and may never write one they do
 *    not own.
 *  - A viewer with `userId: null` is a service credential or the desktop
 *    build. Both carry `role: 'owner'`, so they pass through unchanged — which
 *    is how the desktop build keeps behaving exactly as it always has while the
 *    same code enforces ownership on a server.
 *
 * WHY `owner_id IS NULL` READS AS SHARED-TO-OWNERS-ONLY. Resumes created before
 * accounts existed have no owner. The bootstrap claims them for the first
 * account, so in practice this is a window of one request; but a row that
 * slipped through must not become readable by every member, so an unowned
 * resume is visible only to an owner.
 */

import type { Viewer } from './accounts.js'

/** The access-relevant columns of a resume row. */
export interface OwnedRow {
  owner_id: string | null
  visibility: string
}

export type Visibility = 'private' | 'instance'

/** Anything not recognised reads as `private` — the safe direction. */
export function normaliseVisibility(value: unknown): Visibility {
  return value === 'instance' ? 'instance' : 'private'
}

/** True when `viewer` is unrestricted: the owner role, however it was obtained. */
export function isUnrestricted(viewer: Viewer): boolean {
  return viewer.role === 'owner'
}

/** True when `viewer` created this row. False for a service viewer, which owns nothing. */
export function isOwnRow(viewer: Viewer, row: OwnedRow): boolean {
  return viewer.userId !== null && row.owner_id === viewer.userId
}

/** May `viewer` read this resume? */
export function canRead(viewer: Viewer, row: OwnedRow): boolean {
  if (isUnrestricted(viewer)) return true
  if (isOwnRow(viewer, row)) return true
  // An unowned row is never "shared with everyone" — see the header note.
  if (row.owner_id === null) return false
  return normaliseVisibility(row.visibility) === 'instance'
}

/**
 * May `viewer` change this resume?
 *
 * Sharing grants READ only. A member who could write a shared resume could
 * silently rewrite a colleague's CV, and "shared" has to be safe to switch on.
 */
export function canWrite(viewer: Viewer, row: OwnedRow): boolean {
  if (isUnrestricted(viewer)) return true
  return isOwnRow(viewer, row)
}

/**
 * May `viewer` change who can see this resume?
 *
 * Same rule as writing its content: the person who owns it decides, and an
 * owner can always intervene.
 */
export function canReshare(viewer: Viewer, row: OwnedRow): boolean {
  return canWrite(viewer, row)
}

/**
 * A SQL fragment restricting a `resumes` query to what `viewer` may read, and
 * its parameters.
 *
 * Returns `null` for an unrestricted viewer so the caller uses its existing
 * unscoped statement rather than paying for a tautological predicate — and so
 * the desktop build's queries are byte-for-byte what they were.
 */
export function readableWhere(viewer: Viewer): { sql: string; params: unknown[] } | null {
  if (isUnrestricted(viewer)) return null
  return {
    sql: "(owner_id = ? OR (owner_id IS NOT NULL AND visibility = 'instance'))",
    params: [viewer.userId],
  }
}

/** As `readableWhere`, but for the rows a viewer may change. */
export function writableWhere(viewer: Viewer): { sql: string; params: unknown[] } | null {
  if (isUnrestricted(viewer)) return null
  return { sql: 'owner_id = ?', params: [viewer.userId] }
}
