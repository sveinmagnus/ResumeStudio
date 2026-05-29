import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ResumeStore, Resume, LocalizedString } from '../types'
import { importFromCVPartner } from '../lib/importer'
import { detectLocalesInData, sortLocales } from '../lib/locales'
import { foldRoleDescriptions } from '../lib/migrate'

interface AppState {
  data: ResumeStore
  // UI
  activeSection: string
  primaryLocale: string
  secondaryLocale: string | null
  expandedItemId: string | null
  hasData: boolean

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
  /** Replace data with a server/backup payload. Resets mutationCount. */
  loadStore: (store: ResumeStore) => void
  /** Begin with an empty resume scaffold. Resets mutationCount. */
  startFresh: () => void

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
  setPrimaryLocale: (l: string) => void
  setSecondaryLocale: (l: string | null) => void
  setExpandedItem: (id: string | null) => void

  // ── Resume / locale ───────────────────────────────────────────────────────
  updateResume: (patch: Partial<Resume>) => void
  /** Rescan all data, merge any new locales into resume.supported_locales. */
  detectAndSetLocales: () => void

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

const emptyStore: ResumeStore = {
  resume: null,
  skills: [], roles: [], key_qualifications: [], projects: [],
  work_experiences: [], educations: [], courses: [], certifications: [],
  spoken_languages: [], technology_categories: [], positions: [],
  presentations: [], honor_awards: [], publications: [], references: [],
  views: [],
}

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
    activeSection: 'overview',
    primaryLocale: 'en',
    secondaryLocale: 'no',
    expandedItemId: null,
    hasData: false,
    mutationCount: 0,

    // ── Loads ──────────────────────────────────────────────────────────────

    loadFromCVPartner: (raw) => {
      const data = importFromCVPartner(raw)
      const { primary, secondary } = pickLocales(data.resume?.supported_locales ?? ['en'])
      set({
        data, hasData: true, mutationCount: 0,
        activeSection: 'overview',
        primaryLocale: primary, secondaryLocale: secondary,
      })
    },

    loadStore: (store) => {
      // Bring older persisted data up to the current shape before it enters
      // the store (e.g. fold legacy per-role descriptions into the project).
      const migrated = foldRoleDescriptions(store)
      const locales = migrated.resume?.supported_locales ?? ['en']
      set({
        data: migrated, hasData: true, mutationCount: 0,
        primaryLocale: locales[0] ?? 'en',
        secondaryLocale: locales[1] ?? null,
      })
    },

    startFresh: () => {
      const now = new Date().toISOString()
      const freshStore: ResumeStore = {
        ...emptyStore,
        resume: {
          id: uuidv4(),
          full_name: '', email: '', phone: null,
          title: {}, nationality: {}, place_of_residence: {},
          date_of_birth: null, twitter: null, linkedin_url: null,
          website_url: null, profile_image_url: null,
          default_locale: 'en', supported_locales: ['en'],
          created_at: now, updated_at: now,
        },
      }
      set({
        data: freshStore, hasData: true, mutationCount: 0,
        activeSection: 'header', expandedItemId: null,
        primaryLocale: 'en', secondaryLocale: null,
      })
    },

    // ── In-app wholesale data replacement ──────────────────────────────────

    replaceData: (data) => mutate(() => ({ data })),

    // ── UI ─────────────────────────────────────────────────────────────────

    setActiveSection: (s) => set({ activeSection: s, expandedItemId: null }),
    setPrimaryLocale:   (l) => set({ primaryLocale: l }),
    setSecondaryLocale: (l) => set({ secondaryLocale: l }),
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
      // Sort by current sort_order so positions line up with rendered order
      // (drag indexes are computed from what the user sees, not array order).
      const arr = [...(st.data[section] as Array<{ id: string; sort_order: number }>)]
        .sort((a, b) => a.sort_order - b.sort_order)
      const from = arr.findIndex((it) => it.id === id)
      if (from === -1) return null
      const to = Math.max(0, Math.min(toIndex, arr.length - 1))
      if (from === to) return null
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      arr.forEach((it, i) => { it.sort_order = i })
      return { data: { ...st.data, [section]: arr } }
    }),

    reorderItem: (section, id, direction) => {
      // Thin wrapper: keyboard up/down is just "move by one neighbour".
      const arr = [...(get().data[section] as Array<{ id: string; sort_order: number }>)]
        .sort((a, b) => a.sort_order - b.sort_order)
      const idx = arr.findIndex((it) => it.id === id)
      if (idx === -1) return
      get().moveItem(section, id, direction === 'up' ? idx - 1 : idx + 1)
    },
  }
})

// ─── Helpers for components ────────────────────────────────────────────────────

export function emptyLocalized(): LocalizedString { return {} }

export function newId(): string { return uuidv4() }
