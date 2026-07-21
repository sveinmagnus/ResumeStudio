import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ResumeStore, Resume, LocalizedString, RegistryEntry } from '../types'
import { detectLocalesInData, sortLocales } from '../lib/locales'
import { migrateStore, isNewerShape } from '../lib/migrate'
import { emptyStore as makeEmpty, freshStore as makeFresh } from '../lib/freshStore'
import { sortItems, type SortMode } from '../lib/sectionSort'
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
  moveItem: (section: ArraySectionKey, id: string, toIndex: number) => void
  /** Convenience: keyboard up/down → moveItem on the neighbour. */
  reorderItem: (section: ArraySectionKey, id: string, direction: 'up' | 'down') => void
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
   */
  const mutate = (
    updater: (st: AppState) => Partial<AppState> | null,
  ) => set((st) => {
    const patch = updater(st)
    if (!patch) return {}
    return { ...patch, mutationCount: st.mutationCount + 1 }
  })

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
        data: migrated, hasData: true, mutationCount: 0, sectionSort: {}, sectionTypeFilter: {}, activeViewId: null,
        dataFromNewerApp: isNewerShape(migrated),
        primaryLocale: primary, secondaryLocale: secondary,
      })
    },

    unloadStore: () => set({
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
    setSectionSort: (section, mode) => set((st) => ({
      sectionSort: { ...st.sectionSort, [section]: mode },
    })),
    // Locale changes are persisted server-side per resume (decision 10) — they
    // ride along on the next PUT, so they go through `mutate()` like any other
    // user-visible change. No-op if the value didn't actually change.
    setPrimaryLocale:   (l) => mutate((st) => st.primaryLocale === l ? null : { primaryLocale: l }),
    setSecondaryLocale: (l) => mutate((st) => st.secondaryLocale === l ? null : { secondaryLocale: l }),
    setExpandedItem:    (id) => set((st) => ({ expandedItemId: st.expandedItemId === id ? null : id })),

    // ── Resume / locale ────────────────────────────────────────────────────

    updateResume: (patch) => mutate((st) => {
      if (!st.data.resume) return null
      return {
        data: {
          ...st.data,
          resume: { ...st.data.resume, ...patch, updated_at: new Date().toISOString() },
        },
      }
    }),

    // Acknowledge / un-acknowledge a freshness warning. These touch the
    // dismissals map only (not updated_at) — dismissing a flag isn't "editing
    // content", but it IS a user-visible change that should auto-save, so it
    // goes through `mutate()`.
    dismissAttention: (key, until) => mutate((st) => {
      if (!st.data.resume) return null
      const current = st.data.resume.attention_dismissals ?? {}
      if (current[key] === until) return null // no-op: already set to this value
      return {
        data: {
          ...st.data,
          resume: { ...st.data.resume, attention_dismissals: { ...current, [key]: until } },
        },
      }
    }),

    clearAttentionDismissal: (key) => mutate((st) => {
      if (!st.data.resume) return null
      const current = st.data.resume.attention_dismissals ?? {}
      if (!(key in current)) return null // no-op: nothing to clear
      const next = { ...current }
      delete next[key]
      return {
        data: {
          ...st.data,
          resume: { ...st.data.resume, attention_dismissals: next },
        },
      }
    }),

    detectAndSetLocales: () => mutate((st) => {
      if (!st.data.resume) return null
      const detected = detectLocalesInData(st.data)
      const merged   = sortLocales([...st.data.resume.supported_locales, ...detected, 'en'])
      const current  = st.data.resume.supported_locales
      if (merged.length === current.length && merged.every((l, i) => l === current[i])) return null
      return {
        data: {
          ...st.data,
          resume: { ...st.data.resume, supported_locales: merged, updated_at: new Date().toISOString() },
        },
      }
    }),

    addSupportedLocale: (code) => mutate((st) => {
      const c = code.trim().toLowerCase()
      if (!c || !st.data.resume) return null
      if (st.data.resume.supported_locales.includes(c)) return null // no-op: already present
      const next = sortLocales([...st.data.resume.supported_locales, c])
      return {
        data: {
          ...st.data,
          resume: { ...st.data.resume, supported_locales: next, updated_at: new Date().toISOString() },
        },
      }
    }),

    // ── Generic array ops ──────────────────────────────────────────────────

    updateItem: (section, id, patch) => mutate((st) => {
      const arr = st.data[section] as Array<{ id: string }>
      if (!arr.some((it) => it.id === id)) return null // no-op: id not found
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
      if (!arr.some((it) => it.id === id)) return null // no-op: id not found
      return { data: { ...st.data, [section]: arr.filter((it) => it.id !== id) } }
    }),

    moveItem: (section, id, toIndex) => mutate((st) => {
      // Order by the section's CURRENT display mode so drag/arrow indices line
      // up with what the user sees (which may be alpha/date, not sort_order).
      const mode = st.sectionSort[section] ?? 'custom'
      const arr = sortItems(
        section,
        st.data[section] as unknown as Array<{ id: string; sort_order: number }>,
        mode,
        st.primaryLocale,
      )
      const from = arr.findIndex((it) => it.id === id)
      if (from === -1) return null
      const to = Math.max(0, Math.min(toIndex, arr.length - 1))
      // A no-op only counts as a no-op in custom mode. In a computed mode the
      // user has just confirmed they want to commit the current arrangement,
      // so we still bake it into sort_order + switch back to custom below.
      if (from === to && mode === 'custom') return null
      const moved = [...arr]
      const [item] = moved.splice(from, 1)
      moved.splice(to, 0, item)
      // Bake the resulting order into sort_order (new objects — keep it pure).
      const renumbered = moved.map((it, i) => ({ ...it, sort_order: i }))
      const patch: Partial<AppState> = { data: { ...st.data, [section]: renumbered } }
      // Any manual move makes the section's order custom from now on.
      if (mode !== 'custom') {
        patch.sectionSort = { ...st.sectionSort, [section]: 'custom' }
      }
      return patch
    }),

    reorderItem: (section, id, direction) => {
      // Thin wrapper: keyboard up/down is "move by one neighbour" in the
      // currently-displayed order (mode-aware via moveItem).
      const st = get()
      const mode = st.sectionSort[section] ?? 'custom'
      const arr = sortItems(
        section,
        st.data[section] as unknown as Array<{ id: string; sort_order: number }>,
        mode,
        st.primaryLocale,
      )
      const idx = arr.findIndex((it) => it.id === id)
      if (idx === -1) return
      get().moveItem(section, id, direction === 'up' ? idx - 1 : idx + 1)
    },
  }
})

// ─── Helpers for components ────────────────────────────────────────────────────

export function newId(): string { return uuidv4() }
