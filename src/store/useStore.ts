import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ResumeStore, Resume, LocalizedString } from '../types'
import { importFromCVPartner } from '../lib/importer'
import { detectLocalesInData, sortLocales } from '../lib/locales'
import { foldRoleDescriptions, extractKeyPointsToCompetencies } from '../lib/migrate'
import { emptyStore as makeEmpty, freshStore as makeFresh } from '../lib/freshStore'
import { sortItems, type SortMode } from '../lib/sectionSort'

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
   * Per-section display sort mode (UI-only, NOT persisted). 'custom' (the
   * default for any unset section) renders by `sort_order`; the other modes
   * are computed views. A manual reorder while a computed mode is active
   * bakes the view into `sort_order` and resets the section to 'custom'.
   */
  sectionSort: Record<string, SortMode>

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
  /** Import raw CVpartner JSON. Resets mutationCount. */
  loadFromCVPartner: (raw: Record<string, unknown>) => void
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

  // ── UI state ──────────────────────────────────────────────────────────────
  setActiveSection: (s: string) => void
  /** Open a specific Resume View directly (also switches to the Views section). null = the view list. */
  setActiveView: (id: string | null) => void
  setPrimaryLocale: (l: string) => void
  setSecondaryLocale: (l: string | null) => void
  setExpandedItem: (id: string | null) => void
  /** Change a section's display sort mode (UI-only; does not bump mutationCount). */
  setSectionSort: (section: ArraySectionKey, mode: SortMode) => void

  // ── Resume / locale ───────────────────────────────────────────────────────
  updateResume: (patch: Partial<Resume>) => void
  /** Rescan all data, merge any new locales into resume.supported_locales. */
  detectAndSetLocales: () => void
  /** Add a locale code to resume.supported_locales (no-op if already present). */
  addSupportedLocale: (code: string) => void

  // ── Generic array item ops ────────────────────────────────────────────────
  updateItem: <K extends ArraySectionKey>(section: K, id: string, patch: Partial<ArrayItem<K>>) => void
  addItem: <K extends ArraySectionKey>(section: K, item: ArrayItem<K>) => void
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

  /** Pick sensible primary/secondary locales for a freshly loaded store. */
  const pickLocales = (locales: string[]): { primary: string; secondary: string | null } => {
    const primary = locales.includes('no') ? 'no' : (locales[0] ?? 'en')
    const secondary = locales.includes('en') && primary !== 'en'
      ? 'en'
      : (locales.find((l) => l !== primary) ?? null)
    return { primary, secondary }
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
    sectionSort: {},
    mutationCount: 0,

    // ── Loads ──────────────────────────────────────────────────────────────

    loadFromCVPartner: (raw) => {
      const data = importFromCVPartner(raw)
      const { primary, secondary } = pickLocales(data.resume?.supported_locales ?? ['en'])
      set({
        data, hasData: true, mutationCount: 0,
        activeSection: 'overview', activeViewId: null, sectionSort: {},
        primaryLocale: primary, secondaryLocale: secondary,
      })
    },

    loadStore: (store, localesArg) => {
      // Bring older persisted data up to the current shape before it enters
      // the store (e.g. fold legacy per-role descriptions into the project,
      // promote per-KQ key_points up to standalone key_competencies).
      const migrated = extractKeyPointsToCompetencies(foldRoleDescriptions(store))
      const supported = migrated.resume?.supported_locales ?? ['en']
      // Prefer caller-supplied locales (server-persisted per-resume choice).
      // Fall back to first/second of supported_locales otherwise.
      const primary = localesArg?.primary ?? supported[0] ?? 'en'
      const secondary = localesArg
        ? localesArg.secondary
        : (supported[1] ?? null)
      set({
        data: migrated, hasData: true, mutationCount: 0, sectionSort: {}, activeViewId: null,
        primaryLocale: primary, secondaryLocale: secondary,
      })
    },

    unloadStore: () => set({
      data: emptyStore, hasData: false, mutationCount: 0,
      currentResumeId: null, expandedItemId: null, activeViewId: null, sectionSort: {},
    }),

    setCurrentResumeId: (id) => set({ currentResumeId: id }),

    startFresh: () => {
      set({
        data: makeFresh(), hasData: true, mutationCount: 0,
        activeSection: 'header', expandedItemId: null, activeViewId: null, sectionSort: {},
        primaryLocale: 'en', secondaryLocale: null,
      })
    },

    // ── In-app wholesale data replacement ──────────────────────────────────

    replaceData: (data) => mutate(() => ({ data })),

    // ── UI ─────────────────────────────────────────────────────────────────

    setActiveSection: (s) => set({ activeSection: s, expandedItemId: null }),
    // Deep-link a specific view (or the list when null). Always lands on the
    // Views section. UI-only navigation — no mutationCount bump.
    setActiveView: (id) => set({ activeSection: 'views', activeViewId: id, expandedItemId: null }),
    // Sort mode is a display preference only — plain set, no mutationCount bump
    // (nothing in `data` changes, so there's nothing to auto-save).
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

    addItem: (section, item) => mutate((st) => {
      const arr = st.data[section] as Array<unknown>
      return {
        data: { ...st.data, [section]: [...arr, item] },
        expandedItemId: (item as { id: string }).id,
      }
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

export function emptyLocalized(): LocalizedString { return {} }

export function newId(): string { return uuidv4() }
