/**
 * What counts as a resume id — the one rule, shared by every inbound parser.
 *
 * Zero imports on purpose: `backupFiles.ts` already imports `backup.ts`, so the
 * rule cannot live in either without a cycle, and both need it.
 *
 * WHY a charset and not just "a non-empty string". A resume id arriving in an
 * imported or synced file is a string somebody else wrote, and it is the only
 * field on that path which becomes a FILESYSTEM PATH: `restoreResumes` stores
 * it verbatim, and the next write pass builds `<slug>__<id>.json` and joins it
 * onto the sync folder. An id of `x/../../../../tmp/pwn` therefore writes
 * outside that folder — on every machine sharing it, because the watcher merges
 * inbound files and the scheduler republishes them with no user action.
 *
 * 64 chars is roomy for a UUID (36) while keeping `<slug>__<id>.json` far below
 * any filesystem's name limit.
 */

const RESUME_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Is `id` safe to merge, and to name a file after?
 *
 * `uuidv4()` output satisfies this, as does every id this app has ever minted,
 * so no legitimate resume is affected.
 */
export function isValidResumeId(id: unknown): id is string {
  return typeof id === 'string' && RESUME_ID_RE.test(id)
}
