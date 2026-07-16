import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { useStore } from '../../../store/useStore'
import { DualField } from '../../ui/DualField'
import { SECTIONS } from '../../../lib/sections'
import { sortItems } from '../../../lib/sectionSort'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LOCALE_LABELS } from '../../../lib/locales'
import {
  reorderViewSections, isExportableSection,
  getItemTitle, getItemSubtitle, buildViewHtml, normalizeViewSections,
  defaultViewDetail,
} from '../../../lib/viewFilter'
import { DEFAULT_VIEW_STYLE, normalizeFullLayout } from '../../../lib/viewStyle'
import { getDefaultFonts, onDefaultFontsChanged } from '../../../lib/appPrefs'
import { skillCategoryList } from '../../../lib/skillCategorize'
import { withHeaderDefaults, withFooterDefaults } from '../../../lib/viewHeader'
import { ItemSelectTools } from './ItemSelectTools'
import { selectOnly, isSingleSelectSection } from '../../../lib/viewItemSelect'
import { VIEW_TEMPLATES, getTemplate, applyTemplate } from '../../../lib/viewTemplates'
import { buildViewText, buildViewMarkdown } from '../../../lib/viewText'
import { exportFilename } from '../../../lib/exportFilename'
import type {
  ResumeView, ViewStyle, SectionStyle, ViewSection,
  ViewHeaderConfig, ViewFooterConfig, SortMode,
} from '../../../types'
import {
  Trash2, ChevronUp, ChevronDown, ChevronRight, GripVertical, Pencil,
  ArrowLeft, Star, FileText, FileDown, FileType, FileCode,
  PanelRight, PanelRightClose, ExternalLink,
} from 'lucide-react'
import {
  DetailToggle, SectionStylePanel, sectionModes, type SectionMode,
  SUMMARY_LAYOUT_OPTIONS, FULL_LAYOUT_OPTIONS,
} from './SectionStylePanel'
import { Select } from './Select'
import { ViewStyleControls } from './ViewStyleControls'
import { ViewHeaderControls } from './ViewHeaderControls'
import { ViewFooterControls } from './ViewFooterControls'
import { Styles } from './Styles'

// ─── Content sections (excludes non-content + the skill/role registries) ─────
const CONTENT_SECTIONS = SECTIONS.filter(isExportableSection)

// The show/hide parts of the professional-summary box (key_qualifications) —
// core per-view configuration, surfaced directly on the section (not in the
// collapsible style-override panel).
// Short-vs-long is now the section MODE (Summary → short, Full → the long
// "Full profile"), so only the always-optional header parts remain as toggles.
const KQ_PARTS: Array<{ key: 'kq_show_label' | 'kq_show_tagline'; label: string; def: boolean }> = [
  { key: 'kq_show_label', label: 'About heading', def: true },
  { key: 'kq_show_tagline', label: 'Tag line', def: true },
]

// Compact labels for the collapsed-section overview chips.
const LAYOUT_LABEL = new Map<string, string>(SUMMARY_LAYOUT_OPTIONS)
const FULL_LAYOUT_LABEL = new Map<string, string>(FULL_LAYOUT_OPTIONS)
const DATE_FORMAT_LABEL: Record<string, string> = {
  'month-year': 'Mar 2021', 'year-month': '2021 Mar',
  'month-year-num': '03/2021', 'year-month-num': '2021/03', 'year-only': '2021',
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Short chips summarising a section's chosen options, shown on the collapsed
 * row so the whole section list reads as an overview. Only non-default choices
 * appear; an untouched section shows nothing (caller renders "Default styling").
 */
function sectionConfigChips(vs: ViewSection): string[] {
  const s = vs.style ?? {}
  const chips: string[] = []
  if (vs.detail === 'summary') {
    // 'Tabulated' is shown by the mode button now, not as a chip.
    if (s.summary_layout) chips.push(LAYOUT_LABEL.get(s.summary_layout) ?? s.summary_layout)
    if (s.short_desc_line === 'inline') chips.push('Short desc inline')
  } else if (vs.detail === 'full') {
    if (s.date_position) {
      const fl = normalizeFullLayout(s.date_position)
      chips.push(FULL_LAYOUT_LABEL.get(fl) ?? fl)
    }
  }
  if (s.hide_heading) chips.push('No heading')
  else if (s.heading_text && Object.values(s.heading_text).some((v) => (v ?? '').trim())) chips.push('Custom heading')
  if (s.hide_dates) chips.push('No dates')
  if (s.date_format) chips.push(DATE_FORMAT_LABEL[s.date_format] ?? s.date_format)
  if (s.density) chips.push(cap(s.density))
  if (s.item_divider === false) chips.push('No divider')
  else if (s.divider_style) chips.push(`${cap(s.divider_style)} rule`)
  if (s.tag_style) chips.push(s.tag_style === 'chips' ? 'Chip tags' : 'Inline tags')
  if (vs.key === 'key_qualifications') {
    const parts = KQ_PARTS.filter((p) => (s[p.key] ?? p.def)).map((p) => p.label)
    if (parts.length) chips.push(parts.join(' + '))
  }
  return chips
}

/**
 * A draggable section row in the view's section list. Provides a grip handle to
 * the children via render-prop; the accessible up/down buttons stay too.
 */
function SortableSecRow({ id, off, children }: {
  id: string; off: boolean; children: (handle: ReactNode) => ReactNode
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform), transition,
    opacity: isDragging ? 0.5 : 1, position: 'relative', zIndex: isDragging ? 5 : undefined,
  }
  const handle = (
    <button type="button" className="rv-sec-grip" {...attributes} {...listeners}
      title="Drag to reorder" aria-label="Drag section to reorder">
      <GripVertical size={14} />
    </button>
  )
  return (
    <div ref={setNodeRef} style={style} className={`rv-sec-row ${off ? 'rv-sec-off' : 'rv-sec-on'}${isDragging ? ' rv-sec-dragging' : ''}`}>
      {children(handle)}
      <style>{`
        .rv-sec-grip { color: var(--ink-faint); cursor: grab; display: grid; place-items: center; padding: 2px; touch-action: none; }
        .rv-sec-grip:active { cursor: grabbing; }
        .rv-sec-grip:hover { color: var(--accent); }
        .rv-sec-dragging { box-shadow: var(--shadow-md); }
      `}</style>
    </div>
  )
}

/**
 * The "Export view" dropdown shown at the top of the editor, next to the
 * preview toggle. Groups the PDF / DOCX / Text / Markdown actions behind one
 * trigger so exporting — the frequent task — is always one click away without
 * scrolling to the bottom of the config. Closes on outside-click / Escape.
 */
function ExportMenu({ onPdf, onDocx, onText, onMarkdown, pdfBusy, docxBusy, lastExportedAt }: {
  onPdf: () => void
  onDocx: () => void
  onText: () => void
  onMarkdown: () => void
  pdfBusy: boolean
  docxBusy: boolean
  lastExportedAt: string | null
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // DOCX runs asynchronously and shows a busy label — keep the menu open for it
  // so the progress is visible; the others complete synchronously and close.
  const pick = (fn: () => void, keepOpen = false) => { fn(); if (!keepOpen) setOpen(false) }

  return (
    <div className="rv-exportmenu" ref={ref}>
      <button
        type="button"
        className="rv-export-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <FileDown size={15} /> Export view
        <ChevronDown size={13} className={open ? 'rv-exp-chev open' : 'rv-exp-chev'} />
      </button>
      {open && (
        <div className="rv-export-pop" role="menu">
          <button type="button" role="menuitem" className="rv-export-item" onClick={() => pick(onPdf, true)} disabled={pdfBusy}>
            <FileText size={15} /> {pdfBusy ? 'Building PDF…' : 'Export PDF'}
          </button>
          <button type="button" role="menuitem" className="rv-export-item" onClick={() => pick(onDocx, true)} disabled={docxBusy}>
            <FileDown size={15} /> {docxBusy ? 'Building DOCX…' : 'Export DOCX'}
          </button>
          <button type="button" role="menuitem" className="rv-export-item" onClick={() => pick(onText)}>
            <FileType size={15} /> Text (ATS)
          </button>
          <button type="button" role="menuitem" className="rv-export-item" onClick={() => pick(onMarkdown)}>
            <FileCode size={15} /> Markdown
          </button>
          {lastExportedAt && (
            <div className="rv-export-menu-foot">
              Last exported {new Date(lastExportedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── View editor ──────────────────────────────────────────────────────────────

export function ViewEditor({ view, onBack, onDelete, onUpdate }: {
  view: ResumeView
  onBack: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<ResumeView>) => void
}) {
  const { data, primaryLocale } = useStore()
  const sectionSort = useStore((s) => s.sectionSort)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // Seed from the view's persisted export locale (F11) when it's still a
  // supported locale; else the resume's first locale. Lazy init = once on mount.
  const [exportLocale, setExportLocale] = useState(() => {
    const supported = data.resume?.supported_locales ?? []
    if (view.export_locale && supported.includes(view.export_locale)) return view.export_locale
    return supported[0] ?? primaryLocale
  })
  // Persist the choice on the view so a Board CV always exports in its language.
  const changeExportLocale = (lc: string) => {
    setExportLocale(lc)
    onUpdate({ export_locale: lc })
  }

  // App-wide default fonts a view inherits (edited in Settings); refresh the
  // preview when they change so an "inherit" view follows the new default.
  const [globalFonts, setGlobalFonts] = useState(getDefaultFonts)
  useEffect(() => onDefaultFontsChanged(() => setGlobalFonts(getDefaultFonts())), [])

  // ── Live preview: rebuild HTML on view/data/locale/font changes, debounced ──
  const [previewHtml, setPreviewHtml] = useState(() =>
    buildViewHtml(data, view, exportLocale, globalFonts)
  )
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const popoutRef = useRef<Window | null>(null)
  // Last known preview scroll offset, preserved across rebuilds so tweaking a
  // control doesn't fling the preview back to the top of the résumé (#5).
  const previewScrollRef = useRef(0)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setPreviewHtml(buildViewHtml(data, view, exportLocale, globalFonts))
    }, 250)
    return () => window.clearTimeout(t)
  }, [data, view, exportLocale, globalFonts])

  // Keep a popped-out preview window in sync with the live HTML.
  useEffect(() => {
    const win = popoutRef.current
    if (win && !win.closed) {
      win.document.open()
      win.document.write(previewHtml)
      win.document.close()
    }
  }, [previewHtml])

  // Close the pop-out when leaving the view editor.
  useEffect(() => () => { popoutRef.current?.close() }, [])

  const popOut = () => {
    const win = window.open('', 'rs-view-preview', 'width=900,height=1200')
    if (!win) { setExportError('Please allow pop-ups to open the preview window.'); return }
    popoutRef.current = win
    win.document.open()
    win.document.write(previewHtml)
    win.document.close()
    win.focus()
  }

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let refine: number | undefined
    const A4_PX = 1123 // A4 height at 96 dpi — rough; web fonts shift things slightly
    const measure = () => {
      const body = iframe.contentDocument?.body
      if (!body) return
      setPageCount(Math.max(1, Math.ceil(body.scrollHeight / A4_PX)))
    }
    const restoreScroll = () => {
      const win = iframe.contentWindow
      try { win?.scrollTo(0, previewScrollRef.current) } catch { /* jsdom / cross-origin */ }
    }
    const onLoad = () => {
      const win = iframe.contentWindow
      if (win) {
        // Reapply the saved offset, then keep tracking the user's scrolling on
        // the freshly-loaded document (the old window's listeners died with it).
        restoreScroll()
        win.addEventListener('scroll', () => { previewScrollRef.current = win.scrollY }, { passive: true })
      }
      measure()
      // Web fonts settle a little after load and shift the layout; re-measure
      // and re-pin the scroll so the position holds once heights are final.
      refine = window.setTimeout(() => { measure(); restoreScroll() }, 400)
    }
    iframe.addEventListener('load', onLoad)
    return () => {
      iframe.removeEventListener('load', onLoad)
      if (refine !== undefined) window.clearTimeout(refine)
    }
  }, [previewHtml])

  const overLimit =
    view.page_limit != null && pageCount != null && pageCount > view.page_limit

  // Normalized so sections added after this view was created (e.g. Key
  // Competencies, Recommendations, Promoted Projects) still appear and are
  // configurable. Section edits write the full normalized list back.
  const sections = normalizeViewSections(view.sections)

  // The 4-way mode (Off / Tabulated / Summary / Full) maps onto the stored
  // detail + style.tabulate pair.
  const modeOf = (vs: ViewSection): SectionMode => {
    if (vs.detail === 'off') return 'off'
    // The Skill Matrix is always a table; the professional summary always full.
    if (vs.key === 'skill_matrix') return 'tabulated'
    if (vs.key === 'key_qualifications') return 'full'
    if (vs.detail === 'full') return 'full'
    return vs.style?.tabulate ? 'tabulated' : 'summary'
  }

  const setSectionMode = (key: string, mode: SectionMode) => {
    onUpdate({
      sections: sections.map((s) => {
        if (s.key !== key) return s
        if (mode === 'off') return { ...s, detail: 'off' as const }
        // The Skill Matrix renders its full table for any non-off mode.
        if (key === 'skill_matrix') return { ...s, detail: 'full' as const }
        if (mode === 'full') return { ...s, detail: 'full' as const }
        // Summary variants: 'tabulated' turns tabulate on, 'summary' off.
        const nextStyle = { ...(s.style ?? {}) }
        if (mode === 'tabulated') nextStyle.tabulate = true
        else delete nextStyle.tabulate
        const style = Object.keys(nextStyle).length ? nextStyle : undefined
        return { ...s, detail: 'summary' as const, style }
      }),
    })
  }

  const setSectionSort = (key: string, sort: SortMode) => {
    onUpdate({
      // Drop the field when it's the default so the view stays lean.
      sections: sections.map((s) =>
        s.key === key ? { ...s, sort: sort === 'custom' ? undefined : sort } : s
      ),
    })
  }

  const setSectionStyle = (key: string, patch: SectionStyle | null) => {
    onUpdate({
      sections: sections.map((s) => {
        if (s.key !== key) return s
        if (patch === null) {
          const { style: _drop, ...rest } = s
          void _drop
          return rest
        }
        return { ...s, style: { ...(s.style ?? {}), ...patch } }
      }),
    })
  }

  const moveSection = (key: string, dir: 'up' | 'down') => {
    onUpdate({ sections: reorderViewSections(sections, key, dir) })
  }

  // Drag-and-drop reorder of the section list (keyboard up/down buttons kept).
  const onSectionDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = sections.findIndex((s) => s.key === active.id)
    const to = sections.findIndex((s) => s.key === over.id)
    if (from < 0 || to < 0) return
    const next = [...sections]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onUpdate({ sections: next.map((s, i) => ({ ...s, sort_order: i })) })
  }

  const toggleItem = (itemId: string) => {
    const ex = view.excluded_item_ids
    const next = ex.includes(itemId) ? ex.filter((id) => id !== itemId) : [...ex, itemId]
    onUpdate({ excluded_item_ids: next })
  }

  // Radio single-select (Profile): keep exactly `keepId` of this section's ids.
  const selectOnlyItem = (sectionIds: string[], keepId: string) => {
    onUpdate({ excluded_item_ids: selectOnly(view.excluded_item_ids, sectionIds, keepId) })
  }

  const viewStyle: ViewStyle = view.style ?? DEFAULT_VIEW_STYLE
  const updateViewStyle = (patch: Partial<ViewStyle>) => {
    onUpdate({ style: { ...viewStyle, ...patch } })
  }

  const header = withHeaderDefaults(view.header)
  const updateHeader = (patch: Partial<ViewHeaderConfig>) => {
    onUpdate({ header: { ...header, ...patch } })
  }
  const footer = withFooterDefaults(view.footer)
  const updateFooter = (patch: Partial<ViewFooterConfig>) => {
    onUpdate({ footer: { ...footer, ...patch } })
  }

  const [docxBusy, setDocxBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // The view name is display-only until the user opens it with the pencil.
  const [editingName, setEditingName] = useState(false)
  // Which section rows are expanded (item list + style overrides shown). All
  // collapsed by default so the list reads as a sortable overview (#3).
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set())
  const toggleSection = (key: string) => setOpenSections((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  // Vector PDF straight to a download (no print dialog). pdfmake is ~1.5 MB, so
  // it's lazy-loaded only when the user actually exports — like the DOCX path.
  const handleExport = () => {
    setExportError(null)
    setPdfBusy(true)
    void (async () => {
      try {
        const { exportPdf } = await import('../../../lib/pdfExporter')
        await exportPdf(data, view, exportLocale, globalFonts)
        onUpdate({ last_exported_at: new Date().toISOString() })
      } catch (e) {
        setExportError(`Could not export PDF: ${(e as Error).message}`)
      } finally {
        setPdfBusy(false)
      }
    })()
  }

  // ATS-friendly exports (F6): pure string builders, downloaded as files.
  const handleExportTextual = (ext: 'txt' | 'md') => {
    const content = ext === 'txt'
      ? buildViewText(data, view, exportLocale)
      : buildViewMarkdown(data, view, exportLocale)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFilename(data.resume?.full_name, view.name, ext)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
    onUpdate({ last_exported_at: new Date().toISOString() })
  }

  // The docx library is ~400 kB — lazy-load only when the user clicks Export DOCX.
  const handleExportDocx = async () => {
    setDocxBusy(true)
    setExportError(null)
    try {
      const { exportDocx } = await import('../../../lib/exporter')
      await exportDocx(data, view, exportLocale, globalFonts)
      onUpdate({ last_exported_at: new Date().toISOString() })
    } catch (e) {
      setExportError(`Could not export DOCX: ${(e as Error).message}`)
    } finally {
      setDocxBusy(false)
    }
  }

  const locales = data.resume?.supported_locales ?? [primaryLocale]
  const totalItems = CONTENT_SECTIONS.reduce((acc, s) => {
    if (!s.storeKey || s.virtual) return acc // skip the synthetic promoted_projects (shares projects)
    const vs = view.sections.find((v) => v.key === s.key)
    const detail = vs?.detail ?? defaultViewDetail(s.key)
    if (detail === 'off') return acc
    return acc + (data[s.storeKey] as unknown[]).filter(
      (it) => !(it as { disabled?: boolean }).disabled
    ).length
  }, 0)
  const visibleItems = totalItems - view.excluded_item_ids.length

  return (
    <div className="rv-pane">
      {/* ── Header ── */}
      <div className="rv-editor-header">
        <button className="rv-back-btn" onClick={onBack}>
          <ArrowLeft size={15} /> All views
        </button>
        <div className="rv-editor-stats">
          {visibleItems} items visible
        </div>
        <div className="rv-preview-controls">
          {/* The export language drives the LIVE preview too (buildViewHtml uses
              exportLocale), so the pane always shows what will be exported. */}
          <select
            className="rv-locale-select"
            aria-label="Export language"
            value={exportLocale}
            onChange={(e) => changeExportLocale(e.target.value)}
            title="Language for the preview and export"
          >
            {locales.map((lc) => (
              <option key={lc} value={lc}>
                {LOCALE_LABELS[lc]?.flag} {LOCALE_LABELS[lc]?.name ?? lc}
              </option>
            ))}
          </select>
          <ExportMenu
            onPdf={handleExport}
            onDocx={() => void handleExportDocx()}
            onText={() => handleExportTextual('txt')}
            onMarkdown={() => handleExportTextual('md')}
            pdfBusy={pdfBusy}
            docxBusy={docxBusy}
            lastExportedAt={view.last_exported_at}
          />
          <button
            className="rv-prev-ctrl"
            onClick={() => setShowPreview((v) => !v)}
            title={showPreview ? 'Hide preview' : 'Show preview'}
          >
            {showPreview ? <PanelRightClose size={15} /> : <PanelRight size={15} />}
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
          <button className="rv-prev-ctrl" onClick={popOut} title="Open the preview in a separate window">
            <ExternalLink size={14} /> Pop out
          </button>
        </div>
        <button className="rv-btn-del rv-del-view" onClick={onDelete} title="Delete this view">
          <Trash2 size={14} /> Delete view
        </button>
      </div>

      {exportError && (
        <div className="rv-export-error rv-export-error-top" role="alert">
          {exportError}
          <button className="rv-export-error-x" onClick={() => setExportError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className={`rv-editor-grid${showPreview ? '' : ' rv-grid-solo'}`}>
        <div className="rv-editor-controls">

      {/* ── Name — display-only until opened with the pencil ── */}
      <div className="rv-section-block">
        {editingName ? (
          <>
            <label className="rv-field-label" htmlFor="rv-name-input">View name</label>
            <input
              id="rv-name-input"
              className="rv-name-input"
              value={view.name}
              autoFocus
              onChange={(e) => onUpdate({ name: e.target.value })}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditingName(false) }
              }}
              placeholder="e.g. Board CV, Consultant CV…"
            />
          </>
        ) : (
          <div className="rv-name-display">
            <h2 className="rv-view-name">{view.name || 'Untitled view'}</h2>
            <button
              type="button"
              className="rv-name-edit-btn"
              onClick={() => setEditingName(true)}
              aria-label="Edit view name"
              title="Edit view name"
            >
              <Pencil size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ── Introduction text ── */}
      <div className="rv-section-block">
        <DualField
          label="Introduction text"
          value={view.introduction}
          onChange={(v) => onUpdate({ introduction: v })}
          multiline
          rows={4}
          placeholder="Write an introduction for this view…"
        />
      </div>

      {/* ── Header ── */}
      <div className="rv-section-block">
        <div className="rv-block-heading">Header</div>
        <p className="rv-block-desc">
          Configure the document header — name &amp; title typography, which
          personal-detail rows show (with custom descriptors), and the profile
          photo / company logo placement.
        </p>
        <ViewHeaderControls
          header={header}
          primaryLocale={primaryLocale}
          masterPhoto={data.resume?.profile_photo ?? null}
          masterLogo={data.resume?.company_logo ?? null}
          profileImageUrl={data.resume?.profile_image_url ?? null}
          onChange={updateHeader}
        />
      </div>

      {/* ── Styling ── */}
      <div className="rv-section-block">
        <div className="rv-block-heading">View styling</div>
        <p className="rv-block-desc">
          Visual personality for the whole exported document. Per-section
          overrides live on each section below. Picking a template seeds the
          styling, header, footer and section detail — tweak freely afterwards.
        </p>
        <div className="rv-vs-grid">
          <Select<string>
            label="Template"
            value={getTemplate(view.template_id)?.id ?? ''}
            options={[
              ['', 'None (custom)'],
              ...VIEW_TEMPLATES.map((t): [string, string] => [t.id, t.name]),
            ]}
            onChange={(id) => {
              const patch = applyTemplate(view, id)
              if (patch) onUpdate(patch)
            }}
          />
        </div>
        {getTemplate(view.template_id) && (
          <p className="rv-block-desc">{getTemplate(view.template_id)!.description}</p>
        )}
        <ViewStyleControls style={viewStyle} onChange={updateViewStyle} />
      </div>

      {/* ── Sections ── */}
      <div className="rv-section-block">
        <div className="rv-block-heading">Sections</div>
        <p className="rv-block-desc">
          Pick a detail level per section. <strong>Off</strong> omits the section,
          <strong> Summary</strong> shows one line per item (no descriptions),
          <strong> Full</strong> renders every field.
        </p>

        <div className="rv-section-list">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
          <SortableContext items={sections.map((s) => s.key)} strategy={verticalListSortingStrategy}>
          {sections.map((vs, idx) => {
            const def = CONTENT_SECTIONS.find((s) => s.key === vs.key)
            if (!def || !def.storeKey) return null
            // Virtual technology_categories (Skills Showcase) excludes whole
            // CATEGORIES, not individual skills — its storeKey ('skills') would
            // otherwise list every skill here. Promoted Projects only lists the
            // starred projects (its source set).
            // Honour the section's chosen sort mode so this list matches the
            // editor's order (and, for date modes, the export order). The
            // Skills Showcase AND the Skill Matrix are toggled by CATEGORY.
            const storeItems = (vs.key === 'technology_categories' || vs.key === 'skill_matrix')
              ? skillCategoryList(data).map((c) => ({ id: c.id, name: c.name, disabled: false, starred: false }))
              : sortItems(
                  vs.key,
                  data[def.storeKey] as unknown as Array<{ id: string; sort_order: number; disabled?: boolean; starred?: boolean }>,
                  sectionSort[vs.key] ?? 'custom',
                  primaryLocale,
                )
                  .filter((it) => !it.disabled)
                  .filter((it) => vs.key !== 'promoted_projects' || it.starred)

            const off = vs.detail === 'off'
            const hasStyle = !!vs.style && Object.keys(vs.style).length > 0
            const isOpen = openSections.has(vs.key)
            const chips = off ? [] : sectionConfigChips(vs)

            return (
              <SortableSecRow key={vs.key} id={vs.key} off={off}>
                {(handle) => (
                <>
                <div className="rv-sec-controls">
                  {handle}
                  <button className="rv-ord-btn" aria-label={`Move ${def.label} up`} onClick={() => moveSection(vs.key, 'up')} disabled={idx === 0}>
                    <ChevronUp size={14} />
                  </button>
                  <button className="rv-ord-btn" aria-label={`Move ${def.label} down`} onClick={() => moveSection(vs.key, 'down')} disabled={idx === sections.length - 1}>
                    <ChevronDown size={14} />
                  </button>
                </div>

                <div
                  className="rv-sec-content rv-sec-clickable"
                  onClick={(e) => {
                    const t = e.target as HTMLElement
                    // The detail toggle owns its own clicks; and when expanded, a
                    // click inside the item list / style-override / KQ-parts panel
                    // must not collapse the section.
                    if (t.closest('.rv-detail-toggle')) return
                    if (isOpen && t.closest('.rv-secstyle, .rv-item-list, .rv-item-tools, .rv-item-empty, .rv-kq-parts')) return
                    toggleSection(vs.key)
                  }}
                >
                  <div className="rv-sec-top">
                    <div className="rv-sec-title-line">
                      <span className="rv-sec-title">{def.label}</span>
                      <span className="rv-sec-count">
                        {off
                          ? 'omitted'
                          : `${storeItems.filter((it) => !view.excluded_item_ids.includes(it.id)).length}/${storeItems.length}`}
                      </span>
                    </div>
                    {/* Grouped + pushed flush right (margin-left: auto on the
                        group, not space-between on the row) so the toggle sits
                        right next to the expand arrow on every row, regardless
                        of the title's length or whether this section's toggle
                        has 2 or 4 buttons (key_qualifications / skill_matrix
                        offer fewer modes than the rest). */}
                    <div className="rv-sec-mode-group">
                      <DetailToggle
                        value={modeOf(vs)}
                        modes={sectionModes(vs.key)}
                        onChange={(m) => setSectionMode(vs.key, m)}
                      />
                      {/* The expander is ALWAYS present (even when Off) so the
                          Off/Summary/Full group never shifts. An Off section still
                          expands — to preview which items it holds — but shows no
                          style overrides (there's nothing to style when hidden). */}
                      <button
                        type="button"
                        className="rv-sec-expand"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${def.label}${off ? ' items' : ' settings'}`}
                        onClick={(e) => { e.stopPropagation(); toggleSection(vs.key) }}
                      >
                        <ChevronRight size={16} className={isOpen ? 'rv-chev-open' : ''} />
                      </button>
                    </div>
                  </div>

                  {/* Collapsed: a one-line overview of the chosen options so the
                      whole section list can be scanned and sorted at a glance. */}
                  {!off && !isOpen && (
                    <div className="rv-sec-config">
                      {chips.length
                        ? chips.map((c, i) => <span key={i} className="rv-sec-chip">{c}</span>)
                        : <span className="rv-sec-config-empty">Default styling</span>}
                    </div>
                  )}

                  {/* Expanded: the item list (always), plus — when the section
                      is ON — the KQ parts and style overrides. */}
                  {isOpen && (
                    <>
                      {!off && vs.key === 'key_qualifications' && (
                        <div className="rv-kq-parts">
                          <span className="rv-kq-parts-label">Show parts</span>
                          {KQ_PARTS.map((p) => (
                            <label key={p.key} className="rv-kq-part">
                              <input
                                type="checkbox"
                                checked={vs.style?.[p.key] ?? p.def}
                                onChange={(e) => setSectionStyle(vs.key, { [p.key]: e.target.checked } as SectionStyle)}
                              />
                              <span>{p.label}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {!off && (
                        <SectionStylePanel
                          sectionKey={vs.key}
                          detail={vs.detail}
                          style={vs.style}
                          onChange={(patch) => setSectionStyle(vs.key, patch)}
                          onReset={() => setSectionStyle(vs.key, null)}
                          hasStyle={hasStyle}
                          sort={vs.sort ?? 'custom'}
                          onSortChange={(m) => setSectionSort(vs.key, m)}
                        />
                      )}

                      {storeItems.length > 0 ? (
                        <>
                        <ItemSelectTools
                          sectionKey={vs.key}
                          items={storeItems}
                          excludedIds={view.excluded_item_ids}
                          locale={primaryLocale}
                          roles={data.roles}
                          sectionLabel={def.label}
                          onChange={(excluded_item_ids) => onUpdate({ excluded_item_ids })}
                        />
                        <div className="rv-item-list">
                          {(() => {
                            // Profile is single-select: exactly one block shows,
                            // so its rows are radios. If a saved view excludes
                            // ALL of them (or none is marked), default the visible
                            // radio to the first item so the control never reads
                            // as "nothing chosen" for a section that must show one.
                            const single = isSingleSelectSection(vs.key)
                            const includedIds = storeItems.filter((it) => !view.excluded_item_ids.includes(it.id)).map((it) => it.id)
                            const radioSelected = single ? (includedIds[0] ?? storeItems[0]?.id) : null
                            return storeItems.map((item) => {
                            const excluded = view.excluded_item_ids.includes(item.id)
                            const title = getItemTitle(vs.key, item, primaryLocale)
                            const subtitle = getItemSubtitle(vs.key, item, primaryLocale)
                            const checked = single ? item.id === radioSelected : !excluded
                            return (
                              <label key={item.id} className={`rv-item-row ${checked ? '' : 'rv-item-hidden'}`}>
                                <input
                                  type={single ? 'radio' : 'checkbox'}
                                  name={single ? `rv-profile-${view.id}` : undefined}
                                  checked={checked}
                                  onChange={() => single ? selectOnlyItem(storeItems.map((i) => i.id), item.id) : toggleItem(item.id)}
                                  className="rv-item-check"
                                />
                                <span className="rv-item-info">
                                  <span className="rv-item-title">{title}</span>
                                  {item.starred && <Star size={11} className="rv-item-star" />}
                                  {subtitle && <span className="rv-item-sub">{subtitle}</span>}
                                </span>
                              </label>
                            )
                            })
                          })()}
                        </div>
                        </>
                      ) : (
                        <div className="rv-item-empty">No items in master CV</div>
                      )}
                    </>
                  )}
                </div>
                </>
                )}
              </SortableSecRow>
            )
          })}
          </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* ── Options ── */}
      <div className="rv-section-block">
        <div className="rv-block-heading">Options</div>
        <p className="rv-block-desc">
          <strong>Anonymize clients</strong> renders anonymized customer names on
          every project and redacts reference names to initials — for
          agency/broker submissions.
        </p>
        <div className="rv-options-row">
          <label className="rv-opt-check">
            <input
              type="checkbox"
              checked={view.starred_only}
              onChange={(e) => onUpdate({ starred_only: e.target.checked })}
            />
            Starred items only
          </label>
          <label className="rv-opt-check" title="Render anonymized customer names on every project and redact reference names to initials — for agency/broker submissions.">
            <input
              type="checkbox"
              checked={view.force_anonymized ?? false}
              onChange={(e) => onUpdate({ force_anonymized: e.target.checked })}
            />
            Anonymize clients
          </label>
          <label className="rv-opt-num">
            <span>Page limit</span>
            <input
              type="number"
              min={1} max={20}
              value={view.page_limit ?? ''}
              placeholder="—"
              onChange={(e) => onUpdate({ page_limit: e.target.value ? parseInt(e.target.value) : null })}
              className="rv-page-input"
            />
          </label>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="rv-section-block">
        <div className="rv-block-heading">Footer</div>
        <p className="rv-block-desc">
          A closing visual at the end of the document — an optional separator
          line and a short copyright statement.
        </p>
        <ViewFooterControls
          footer={footer}
          hasCompany={!!(data.resume?.company_name ?? '').trim()}
          onChange={updateFooter}
        />
      </div>

        </div>

        {showPreview && (
        <aside className="rv-preview-pane">
          <div className="rv-preview-header">
            <span className="rv-preview-label">Preview</span>
            {pageCount != null && (
              <span className={`rv-preview-pages${overLimit ? ' rv-preview-over' : ''}`}>
                ≈ {pageCount} page{pageCount !== 1 ? 's' : ''}
                {view.page_limit != null ? ` / ${view.page_limit}` : ''}
              </span>
            )}
            <div className="rv-preview-head-actions">
              <button className="rv-preview-iconbtn" onClick={popOut} title="Open in a separate window" aria-label="Pop out preview">
                <ExternalLink size={14} />
              </button>
              <button className="rv-preview-iconbtn" onClick={() => setShowPreview(false)} title="Hide preview" aria-label="Hide preview">
                <PanelRightClose size={15} />
              </button>
            </div>
          </div>
          {/*
            sandbox="allow-same-origin" disables script execution inside the
            preview but keeps the document same-origin so the parent can still
            measure scrollHeight for the page-count badge. Defence in depth on
            top of the escape-at-render + CSP in buildViewHtml.
          */}
          <iframe
            ref={iframeRef}
            className="rv-preview-frame"
            srcDoc={previewHtml}
            title="Resume View preview"
            sandbox="allow-same-origin"
          />
        </aside>
        )}
      </div>

      <Styles />
    </div>
  )
}
