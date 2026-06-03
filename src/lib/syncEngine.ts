/**
 * PURE sync-decision logic, extracted from `useResumePersistence` so the
 * branchy, high-risk parts are testable without timers, the store, or the DOM.
 * The hook stays thin glue around these functions.
 */

/** What the boot sequence should do, given the server result + local queue. */
export type BootAction =
  /** A dirty pending record exists and the server is reachable → push the
   *  local edits (with their base version) instead of taking the server copy. */
  | { kind: 'flush-local' }
  /** Take the server copy as the source of truth (drop any clean local record). */
  | { kind: 'load-server' }
  /** Unknown id, or unreachable with nothing cached → there's nothing to show. */
  | { kind: 'not-found' }
  /** Server unreachable but a local record exists → load it and work offline. */
  | { kind: 'offline-local' }

export interface BootInput {
  /** Outcome of the server load attempt. */
  server: 'hit' | 'not-found' | 'unreachable'
  /** The local pending record, if any (only `dirty` matters to the decision). */
  pending: { dirty: boolean } | null
}

/**
 * Decide the boot action. The rules, in one place:
 *   - server hit + dirty local edits  → flush-local (local work wins, then sync)
 *   - server hit + no/clean local     → load-server
 *   - server says 404                 → not-found (no cache fallback for ghosts)
 *   - server unreachable + any record → offline-local
 *   - server unreachable + nothing    → not-found
 */
export function decideBoot({ server, pending }: BootInput): BootAction {
  if (server === 'hit') {
    return pending?.dirty ? { kind: 'flush-local' } : { kind: 'load-server' }
  }
  if (server === 'not-found') return { kind: 'not-found' }
  // unreachable
  return pending ? { kind: 'offline-local' } : { kind: 'not-found' }
}

/**
 * Split the set of dirty resume ids into the active one (resolved through the
 * editor, so it can surface a conflict modal) and the rest (drained in the
 * background). The active id is included only if it's actually dirty.
 */
export function selectDrainTargets(
  dirtyIds: string[],
  activeId: string,
): { active: boolean; background: string[] } {
  return {
    active: dirtyIds.includes(activeId),
    background: dirtyIds.filter((id) => id !== activeId),
  }
}
