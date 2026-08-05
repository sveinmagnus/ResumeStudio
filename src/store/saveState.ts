/**
 * The save state machine.
 *
 * Lives in `store/` because that is what OWNS it: `useResumePersistence` drives
 * every transition, and `SaveStatus` only renders whatever it is handed.
 * Declaring it in the component would make the store import a type from the
 * component layer — an inversion of the app's own layering (CLAUDE.md §3), and
 * the kind that spreads once one exists.
 */
export type SaveState =
  /** Nothing to report. */
  | 'idle'
  /** A server save is in flight. */
  | 'saving'
  /** The last server save succeeded. */
  | 'saved'
  /** The last server save failed; the local cache holds the work. */
  | 'error'
  /** The server is confirmed unreachable; the cache is the source of truth. */
  | 'offline'
  /** Online, but a save didn't land — edits are held locally and will retry. */
  | 'queued'
  /** The server copy changed elsewhere; local edits held, awaiting resolve. */
  | 'conflict'
