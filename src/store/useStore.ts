import { create } from 'zustand'
import { uuidv4 } from '../lib/uuid'
import type { ResumeStore, Resume, RegistryEntry } from '../types'
import { detectLocalesInData, sortLocales } from '../lib/locales'
import { migrateStore, isNewerShape } from '../lib/migrate'
import { emptyStore as makeEmpty, freshStore as makeFresh } from '../lib/freshStore'
import { sortItems, type SortMode } from '../lib/sectionSort'
import { loadSortPrefs, saveSortPrefs } from '../lib/sortPrefs'
import { overlayCanonicalNames } from '../lib/registrySync'

interface AppState {
  data: ResumeStore
  /** Server id of the currently loaded resume. null when the editor isn't on a resume. */
  currentResumeId: string | null
  // UI
  activeSection: string
  /** When in the Resume Views section, the view being edited (null = the list). */
  activeViewId: string | null
  primaryLocale: string
  secondaryLocale: string | null
  expandedItemId: string | null
  hasData: boolean
  /**
   * True when the loaded resume was last saved by a build with a NEWER data
   * shape than this one (see `lib/migrate.ts → isNewerShape`). The editor
   * shows a best-effort warning; editing stays enabled. Reset on unload.
   */
  dataFromNewerApp: boolean
  /**
   * Per-section display sort mode (UI-only, NOT persisted). 'custom' (the
   * default for any unset section) renders by `sort_order`; the other modes
   * are computed views. A manual reorder while a computed mode is active
   * bakes the view into `sort_order` and resets the section to 'custom'.
   */
  sectionSort: Record<string, SortMode>

  /**
   * Per-section EDITOR type filter (UI-only, NOT persisted, no effect on views
   * or exports). Keyed by section → an opaque `typeFilterKey(facet, value)`
   * (see lib/viewItemSelect); an unset/empty section shows all items. Lets the
   * consultant narrow a section to one type while editing, like the registries'
   * category view.
   */
  sectionTypeFilter: Record<string, string>

  /**
   * True when the loaded resume is somebody else's, shared with the team.
   *
   * `mutate()` drops every data write while this is set — not merely the UI
   * that offers them. The server answers a refused write with 404 (so a member
   * cannot enumerate resume ids), so an edit that got through would become a
   * queued local record that can never drain and would read as data loss on a
   * colleague's CV. Blocking at the one choke point is the only version of this
   * that eighty editor components cannot each get wrong.
   */
  readOnly: boolean
  /** Set by `useResumePersistence` once the loaded resume's owner is known. */
  setReadOnly: (readOnly: boolean) => void

  /**
   * Monotonic counter that increments on every USER-initiated data mutation.
   * Load actions reset it to 0. The auto-save effect uses this to decide
   * whether to fire — comparing it to a "last-saved" ref. This replaced an
   * earlier hack of remembering to flip a `skipNextSave` ref before each
   * load call site.
   *
   * Every mutating action MUST bump this counter. The `mutate()` helper at
   * the bottom of this file does that automatically — actions added in the
   * future should funnel through it rather than writing raw `set(...)`.
   */
  mutationCount: number

  // ── Load actions (do NOT bump mutationCount) ──────────────────────────────
  /**
   * Replace data with a server/backup payload. Resets mutationCount.
   * Optional `locales` seeds primary/secondary from the resume row; if omitted
   * the previous derive-from-data behaviour applies.
   */
  loadStore: (store: ResumeStore, locales?: { primary: string; secondary: string | null }) => void
  /** Begin with an empty resume scaffold. Resets mutationCount. */
  startFresh: () => void
  /** Eject the in-memory resume — used when navigating away from /r/:id. */
  unloadStore: () => void
  /** Track which resume is loaded (navigation/UX, not a data mutation). */
  setCurrentResumeId: (id: string | null) => void

  // ── Data rewrite actions (DO bump mutationCount, so undo/save pick them up) ─
  /**
   * In-app wholesale replacement of the resume data. Use this for operations
   * like undo/redo or registry merges — anything where you've computed a new
   * `data` and want the auto-save + undo systems to treat it as a mutation
   * the user initiated.
   *
   * The distinction from `loadStore` matters: `loadStore` is for I/O (server
   * load, file open) where we want to start a fresh editing session.
   * `replaceData` is for in-app rewrites where we want continuity.
   */
  replaceData: (data: ResumeStore) => void

  // ── Cross-resume registry (shared canonical layer) ─────────────────────────
  /**
   * Reconcile linked registry entries' identity FROM the instance registry
   * (`overlayCanonicalNames`). Display-only — a raw set with NO mutationCount
   * bump, so it never triggers auto-save; a no-op (same store ref) when nothing
   * links. Called at boot after the resume loads.
   */
  reconcileRegistry: (entries: RegistryEntry[]) => void
  /**
   * A non-blocking message when a shared-registry rename couldn't be applied
   * because the entry changed on another device (server won). Rendered by
   * `RegistryConflictNotice`; `null` clears it. UI-only — no mutationCount bump.
   */
  registryNotice: string | null
  setRegistryNotice: (message: string | null) => void

  // ── UI state ──────────────────────────────────────────────────────────────
  setActiveSection: (s: string) => void
  /** Open a specific Resume View directly (also switches to the Views section). null = the view list. */
  setActiveView: (id: string | null) => void
  setPrimaryLocale: (l: string) => void
  setSecondaryLocale: (l: string | null) => void
  setExpandedItem: (id: string | null) => void
  /**
   * Open a card outright, without `setExpandedItem`'s toggle. Restoring state
   * (browser Back) must not close the card when it happens to already be the
   * open one — a toggle turns "put it back" into "close it".
   */
  openItem: (id: string | null) => void
  /** Change a section's display sort mode (UI-only; does not bump mutationCount). */
  setSectionSort: (section: ArraySectionKey, mode: SortMode) => void
  /** Set a section's editor type filter (UI-only; '' clears it). */
  setSectionTypeFilter: (section: ArraySectionKey, key: string) => void

  // ── Resume / locale ───────────────────────────────────────────────────────
  updateResume: (patch: Partial<Resume>) => void
  /**
   * Dismiss a "Needs attention" warning until the given ISO timestamp — the
   * consultant has judged it doesn't need attention, so it stays suppressed
   * (see `lib/freshness.ts → snoozeUntil`). Persisted on the resume so it
   * syncs/backs-up. No-op when there's no loaded resume.
   */
  dismissAttention: (key: string, until: string) => void
  /** Un-dismiss a previously snoozed warning so it can surface again. */
  clearAttentionDismissal: (key: string) => void
  /**
   * Permanently ignore a cross-language "check" finding judged a false positive
   * (`DriftFinding.dismissKey`). Appends to `resume.drift_dismissals`; no expiry.
   */
  dismissDrift: (key: string) => void
  /** Rescan all data, merge any new locales into resume.supported_locales. */
  detectAndSetLocales: () => void
  /** Add a locale code to resume.supported_locales (no-op if already present). */
  addSupportedLocale: (code: string) => void

  // ── Generic array item ops ────────────────────────────────────────────────
  updateItem: <K extends ArraySectionKey>(section: K, id: string, patch: Partial<ArrayItem<K>>) => void
  /**
   * Append a new item. It is placed at the TOP of the custom (`sort_order`)
   * order — a freshly added item shouldn't sink to the bottom of a
   * reverse-timeline list (until it's dated the date-sort views float it up
   * too; see `lib/sectionSort`). By default the new item's card is opened;
   * pass `{ open: false }` when creating a registry entry from inside another
   * editor so it doesn't steal focus (and collapse) the parent card.
   */
  addItem: <K extends ArraySectionKey>(section: K, item: ArrayItem<K>, opts?: { open?: boolean }) => void
  removeItem: (section: ArraySectionKey, id: string) => void
  /** Move `id` to the given index (clamped to bounds), then renormalise sort_order. */
  /**
   * Move an item to `toIndex` within the list the user is LOOKING at.
   *
   * `visibleIds` is that list — post type-filter, post expanded-card pin — and
   * the caller supplies it because only the component knows it (the pin lives
   * in a React ref inside `useStableExpanded`, not here). Omit it and the
   * section's full sorted order is assumed, which is what it is when no filter
   * is on. Hidden items keep their absolute position; only the visible ones are
   * rearranged among the slots they already occupy.
   */
  moveItem: (section: ArraySectionKey, id: string, toIndex: number, visibleIds?: readonly string[]) => void
  /** Convenience: keyboard up/down → moveItem on the neighbour. */
  reorderItem: (
    section: ArraySectionKey, id: string, direction: 'up' | 'down',
    visibleIds?: readonly string[],
  ) => void
}

type ArraySectionKey = Exclude<keyof ResumeStore, 'resume'>
type ArrayItem<K extends ArraySectionKey> = ResumeStore[K] extends Array<infer T> ? T : never

// Wrap the helper so existing in-file `emptyStore` references read the same
// constant reference between calls (cheap-but-fresh-on-read semantics —
// suitable for "reset to nothing" cases like `unloadStore`).
const emptyStore: ResumeStore = makeEmpty()

export const useStore = create<AppState>((set, get) => {
  /**
   * Wrap a state-producing updater so it always bumps `mutationCount`.
   * Returning `null` signals a no-op: state is left alone and the counter is
   * not bumped (so the auto-save effect won't fire spuriously).
   *
   * On a READ-ONLY resume the write is dropped entirely (see `readOnly`). Pass
   * `{ display: true }` for the handful of actions that are a viewing
   * preference the server merely happens to persist — the language pair — so a
   * colleague's shared CV can still be read in either column.
   */
  const mutate = (
    updater: (st: AppState) => Partial<AppState> | null,
    opts?: { display?: boolean },
  ) => set((st) => {
    const patch = updater(st)
    if (!patch) return {}
    if (st.readOnly) return opts?.display ? patch : {}
    return { ...patch, mutationCount: st.mutationCount + 1 }
  })

  /**
   * Shorthand for the six actions that patch `data.resume`: returns the state
   * patch, or null (a no-op) when there's no loaded resume. `derive` gets the
   * current resume and returns the fields to merge onto it, or null to skip —
   * which is how each action expresses "nothing actually changed".
   */
  const patchResume = (
    st: AppState,
    derive: (resume: Resume) => Partial<Resume> | null,
  ): Partial<AppState> | null => {
    if (!st.data.resume) return null
    const fields = derive(st.data.resume)
    if (!fields) return null
    return { data: { ...st.data, resume: { ...st.data.resume, ...fields } } }
  }

  return {
    data: emptyStore,
    currentResumeId: null,
    activeSection: 'overview',
    activeViewId: null,
    primaryLocale: 'en',
    secondaryLocale: 'no',
    expandedItemId: null,
    hasData: false,
    dataFromNewerApp: false,
    sectionSort: {},
    sectionTypeFilter: {},
    mutationCount: 0,
    registryNotice: null,
    readOnly: false,

    setReadOnly: (readOnly) => set({ readOnly }),

    // ── Loads ──────────────────────────────────────────────────────────────

    loadStore: (store, localesArg) => {
      // Bring older persisted data up to the current shape (and stamp it)
      // before it enters the store. Data from a NEWER build passes through
      // untouched — flagged so the editor can warn (see dataFromNewerApp).
      const migrated = migrateStore(store)
      const supported = migrated.resume?.supported_locales ?? ['en']
      // Prefer caller-supplied locales (server-persisted per-resume choice).
      // Fall back to first/second of supported_locales otherwise.
      const primary = localesArg?.primary ?? supported[0] ?? 'en'
      const secondary = localesArg
        ? localesArg.secondary
        : (supported[1] ?? null)
      set({
        // Sort modes are restored from localStorage, not reset: this is the
        // one place a reload, a remote-update reload and a snapshot restore all
        // funnel through, and blanking it here is what made a chosen sort look
        // like it had reverted to Custom on its own. The type filter IS reset —
        // see lib/sortPrefs.ts on why a hidden-rows state must not persist.
        //
        // Keyed on `currentResumeId` (the row id the URL and picker use), which
        // the load effect sets before calling this. NOT `data.resume.id`: that
        // is the id INSIDE the document and the two genuinely differ, so two
        // resumes imported from one backup file would share a sort preference.
        data: migrated, hasData: true, mutationCount: 0,
        sectionSort: loadSortPrefs(get().currentResumeId), sectionTypeFilter: {}, activeViewId: null,
        dataFromNewerApp: isNewerShape(migrated),
        primaryLocale: primary, secondaryLocale: secondary,
      })
    },

    unloadStore: () => set({
      // readOnly is per-resume, so ejecting one must clear it — otherwise the
      // next resume opened inherits the last one's lock and silently swallows
      // every edit.
      readOnly: false,
      data: emptyStore, hasData: false, mutationCount: 0, dataFromNewerApp: false,
      currentResumeId: null, expandedItemId: null, activeViewId: null, sectionSort: {}, sectionTypeFilter: {},
    }),

    setCurrentResumeId: (id) => set({ currentResumeId: id }),

    startFresh: () => {
      set({
        data: makeFresh(), hasData: true, mutationCount: 0, dataFromNewerApp: false,
        activeSection: 'header', expandedItemId: null, activeViewId: null, sectionSort: {}, sectionTypeFilter: {},
        primaryLocale: 'en', secondaryLocale: null,
      })
    },

    // ── In-app wholesale data replacement ──────────────────────────────────

    replaceData: (data) => mutate(() => ({ data })),

    // ── Cross-resume registry ────────────────────────────────────────────────

    reconcileRegistry: (entries) => set((st) => {
      // Raw set, no mutationCount bump: this reconciles DISPLAY names from the
      // shared registry, not a user edit — it must not trigger auto-save.
      // overlayCanonicalNames returns the same ref when nothing links, so an
      // un-shared resume skips the set entirely.
      const next = overlayCanonicalNames(st.data, entries)
      return next === st.data ? {} : { data: next }
    }),

    setRegistryNotice: (message) => set({ registryNotice: message }),

    // ── UI ─────────────────────────────────────────────────────────────────

    setActiveSection: (s) => set({ activeSection: s, expandedItemId: null }),
    // Deep-link a specific view (or the list when null). Always lands on the
    // Views section. UI-only navigation — no mutationCount bump.
    setActiveView: (id) => set({ activeSection: 'views', activeViewId: id, expandedItemId: null }),
    // Sort mode is a display preference only — plain set, no mutationCount bump
    // (nothing in `data` changes, so there's nothing to auto-save).
    setSectionTypeFilter: (section, key) => set((st) => ({
      sectionTypeFilter: { ...st.sectionTypeFilter, [section]: key },
    })),
    setSectionSort: (section, mode) => set((st) => {
      const sectionSort = { ...st.sectionSort, [section]: mode }
      saveSortPrefs(st.currentResumeId, sectionSort)
      return { sectionSort }
    }),
    // Locale changes are persisted server-side per resume (decision 10) — they
    // ride along on the next PUT, so they go through `mutate()` like any other
    // user-visible change. No-op if the value didn't actually change.
    //
    // `display` so they survive a read-only resume: which two languages you are
    // looking at is a viewing choice, and refusing it would leave a colleague's
    // shared CV readable in one column only.
    setPrimaryLocale:   (l) => mutate((st) => st.primaryLocale === l ? null : { primaryLocale: l }, { display: true }),
    setSecondaryLocale: (l) => mutate((st) => st.secondaryLocale === l ? null : { secondaryLocale: l }, { display: true }),
    setExpandedItem:    (id) => set((st) => ({ expandedItemId: st.expandedItemId === id ? null : id })),
    openItem:           (id) => set({ expandedItemId: id }),

    // ── Resume / locale ────────────────────────────────────────────────────

    updateResume: (patch) => mutate((st) =>
      patchResume(st, () => ({ ...patch, updated_at: new Date().toISOString() }))),

    // Acknowledge / un-acknowledge a freshness warning. These touch the
    // dismissals map only (not updated_at) — dismissing a flag isn't "editing
    // content", but it IS a user-visible change that should auto-save, so it
    // goes through `mutate()`.
    dismissAttention: (key, until) => mutate((st) => patchResume(st, (r) => {
      const current = r.attention_dismissals ?? {}
      if (current[key] === until) return null
      return { attention_dismissals: { ...current, [key]: until } }
    })),

    clearAttentionDismissal: (key) => mutate((st) => patchResume(st, (r) => {
      const current = r.attention_dismissals ?? {}
      if (!(key in current)) return null
      const next = { ...current }
      delete next[key]
      return { attention_dismissals: next }
    })),

    dismissDrift: (key) => mutate((st) => patchResume(st, (r) => {
      const current = r.drift_dismissals ?? []
      if (current.includes(key)) return null
      return { drift_dismissals: [...current, key] }
    })),

    detectAndSetLocales: () => mutate((st) => patchResume(st, (r) => {
      const detected = detectLocalesInData(st.data)
      const merged   = sortLocales([...r.supported_locales, ...detected, 'en'])
      const current  = r.supported_locales
      if (merged.length === current.length && merged.every((l, i) => l === current[i])) return null
      return { supported_locales: merged, updated_at: new Date().toISOString() }
    })),

    addSupportedLocale: (code) => mutate((st) => patchResume(st, (r) => {
      const c = code.trim().toLowerCase()
      if (!c || r.supported_locales.includes(c)) return null
      return {
        supported_locales: sortLocales([...r.supported_locales, c]),
        updated_at: new Date().toISOString(),
      }
    })),

    // ── Generic array ops ──────────────────────────────────────────────────

    updateItem: (section, id, patch) => mutate((st) => {
      const arr = st.data[section] as Array<{ id: string }>
      if (!arr.some((it) => it.id === id)) return null
      const next = arr.map((it) => (it.id === id ? { ...it, ...patch } : it))
      return { data: { ...st.data, [section]: next } }
    }),

    addItem: (section, item, opts) => mutate((st) => {
      const arr = st.data[section] as unknown as Array<Record<string, unknown>>
      // Place new items at the top of the custom order: give the new item a
      // sort_order below every existing one (sort ascends by sort_order). Only
      // touch sections whose items actually carry sort_order.
      let toAdd = item as Record<string, unknown>
      if ('sort_order' in toAdd) {
        const minOrder = arr.reduce(
          (m, it) => Math.min(m, typeof it.sort_order === 'number' ? it.sort_order : 0),
          0,
        )
        toAdd = { ...toAdd, sort_order: minOrder - 1 }
      }
      const patch: Partial<AppState> = { data: { ...st.data, [section]: [...arr, toAdd] } }
      // Open the new card unless the caller opts out (nested registry creation).
      if (opts?.open !== false) patch.expandedItemId = (toAdd as { id: string }).id
      return patch
    }),

    removeItem: (section, id) => mutate((st) => {
      const arr = st.data[section] as Array<{ id: string }>
      if (!arr.some((it) => it.id === id)) return null
      return { data: { ...st.data, [section]: arr.filter((it) => it.id !== id) } }
    }),

    moveItem: (section, id, toIndex, visibleIds) => mutate((st) => {
      // Order by the section's CURRENT display mode so drag/arrow indices line
      // up with what the user sees (which may be alpha/date, not sort_order).
      const mode = st.sectionSort[section] ?? 'custom'
      const full = sortItems(
        section,
        st.data[section] as unknown as Array<{ id: string; sort_order: number }>,
        mode,
        st.primaryLocale,
      )
      const present = new Set(full.map((it) => it.id))

      // The rows actually on screen. A type filter hides some, and the expanded
      // card is pinned at the index it had when opened, so this can differ from
      // `full` in both membership AND order — which is why the caller passes it.
      // Stale ids are dropped rather than trusted: `visibleIds` is a prop from
      // the previous render and an item may have been deleted since.
      const visible = visibleIds?.length
        ? visibleIds.filter((vid) => present.has(vid))
        : full.map((it) => it.id)

      const from = visible.indexOf(id)
      if (from === -1) return null
      const to = Math.max(0, Math.min(toIndex, visible.length - 1))
      // A move that lands where it started changes nothing, in EVERY mode.
      //
      // This used to bake + switch to Custom in a computed mode, on the reading
      // that the user had just confirmed committing the arrangement. But drag
      // can never produce from === to (SortableList returns early when the drop
      // target is the dragged item), so the only way here was pressing Move up
      // on the top row or Move down on the bottom row — where nothing moves.
      // The section silently became Custom, sort_order was rewritten and the
      // result auto-saved, which is how a chosen sort "reset itself".
      if (from === to) return null

      // Rearrange the visible rows among themselves.
      const movedVisible = [...visible]
      const [movedId] = movedVisible.splice(from, 1)
      movedVisible.splice(to, 0, movedId)

      // Write them back into the slots the visible rows already occupied, so a
      // hidden item keeps its absolute position instead of being leapfrogged.
      // Without this, dragging the 2nd of 2 visible rows above the 1st sent it
      // to the top of the WHOLE section, past every filtered-out item.
      const byId = new Map(full.map((it) => [it.id, it]))
      const slots: number[] = []
      const visibleSet = new Set(visible)
      full.forEach((it, i) => { if (visibleSet.has(it.id)) slots.push(i) })
      const placed = [...full]
      slots.forEach((slot, k) => { placed[slot] = byId.get(movedVisible[k])! })

      // Bake the resulting order into sort_order (new objects — keep it pure).
      const renumbered = placed.map((it, i) => ({ ...it, sort_order: i }))
      const patch: Partial<AppState> = { data: { ...st.data, [section]: renumbered } }
      // Any manual move makes the section's order custom from now on — and
      // that has to be persisted like any other sort choice, or the next reload
      // would restore the OLD computed mode and re-sort the order the user just
      // baked by hand.
      if (mode !== 'custom') {
        const sectionSort = { ...st.sectionSort, [section]: 'custom' as SortMode }
        saveSortPrefs(st.currentResumeId, sectionSort)
        patch.sectionSort = sectionSort
      }
      return patch
    }),

    reorderItem: (section, id, direction, visibleIds) => {
      // Thin wrapper: keyboard up/down is "move by one neighbour" in the
      // currently-displayed order (mode- and filter-aware via moveItem).
      const st = get()
      const mode = st.sectionSort[section] ?? 'custom'
      const full = sortItems(
        section,
        st.data[section] as unknown as Array<{ id: string; sort_order: number }>,
        mode,
        st.primaryLocale,
      )
      const present = new Set(full.map((it) => it.id))
      const visible = visibleIds?.length
        ? visibleIds.filter((vid) => present.has(vid))
        : full.map((it) => it.id)
      const idx = visible.indexOf(id)
      if (idx === -1) return
      const to = direction === 'up' ? idx - 1 : idx + 1
      // Off either end: there is no neighbour to swap with, so do nothing at
      // all rather than clamping back onto the item's own index (see moveItem).
      if (to < 0 || to >= visible.length) return
      get().moveItem(section, id, to, visibleIds)
    },
  }
})

// ─── Helpers for components ────────────────────────────────────────────────────

export function newId(): string { return uuidv4() }
