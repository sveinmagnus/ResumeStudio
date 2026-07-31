/**
 * The save state machine.
 *
 * Lives in `store/` because that is what OWNS it: `useResumePersistence` drives
 * every transition, and `SaveStatus` only renders whatever it is handed. It was
 * declared in the component, which meant the store imported a type from the
 * component layer — an inversion of the app's own layering (CLAUDE.md §3), and
 * the kind that spreads once one exists.
 */
export type SaveState =
  | 'idle'        // nothing to report
  | 'saving'      // server save in flight
  | 'saved'       // last server save succeeded
  | 'error'       // last server save failed; local cache holds the work
  | 'offline'     // server confirmed unreachable; cache is the source of truth
  | 'queued'      // online but a save didn't land; edits held locally, will retry
  | 'conflict'    // server copy changed elsewhere; local edits held, awaiting resolve
