/**
 * Snapshot-based undo/redo history with burst capture.
 *
 * Pure and timer-free so it can be unit-tested in isolation. The React hook
 * (`store/useUndoRedo`) drives it: it calls `onMutation()` with the
 * pre-mutation snapshot on every user change, schedules a debounce, and calls
 * `commit()` when the debounce elapses (or `flush()` immediately before an
 * undo/redo).
 *
 * ── Burst capture ──
 * A run of mutations with no commit between them collapses into ONE undo
 * step that reverts the WHOLE burst. We do this by remembering only the
 * FIRST pre-mutation snapshot of a burst and ignoring later ones until
 * `commit()` banks it. (Remembering the *last* snapshot instead — the
 * obvious-looking version — would make undo revert only the final keystroke
 * of a burst and silently lose the pre-burst state.)
 */
export class UndoHistory<T> {
  private past: T[] = []
  private future: T[] = []
  private burstSnapshot: T | null = null
  private burstActive = false

  constructor(private readonly max = 100) {}

  /**
   * Record the state as it was BEFORE a user mutation. Only the first call
   * of a burst is retained; subsequent calls (until `commit`) are ignored so
   * the whole burst undoes as one step.
   */
  onMutation(preMutationState: T): void {
    if (!this.burstActive) {
      this.burstSnapshot = preMutationState
      this.burstActive = true
    }
  }

  /** True while a burst snapshot is captured but not yet banked. */
  get hasPendingBurst(): boolean {
    return this.burstActive
  }

  /** Bank the current burst's snapshot onto the past stack (no-op if none). */
  commit(): void {
    if (!this.burstActive) return
    this.past.push(this.burstSnapshot as T)
    if (this.past.length > this.max) this.past.shift()
    // A fresh user action invalidates the redo branch.
    this.future = []
    this.burstSnapshot = null
    this.burstActive = false
  }

  /**
   * Undo. Pass the current state (pushed to the redo stack). Returns the
   * snapshot to restore, or null if there's nothing to undo.
   */
  undo(current: T): T | null {
    const snap = this.past.pop()
    if (snap === undefined) return null
    this.future.push(current)
    return snap
  }

  /** Redo. Symmetric to `undo`. */
  redo(current: T): T | null {
    const snap = this.future.pop()
    if (snap === undefined) return null
    this.past.push(current)
    return snap
  }

  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
}
