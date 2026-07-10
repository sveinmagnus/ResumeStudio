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
import { DEFAULT_VIEW_STYLE } from '../../../lib/viewStyle'
import { skillCategoryList } from '../../../lib/skillCategorize'
import { withHeaderDefaults, withFooterDefaults } from '../../../lib/viewHeader'
import { VIEW_TEMPLATES, getTemplate, applyTemplate } from '../../../lib/viewTemplates'
import { buildViewText, buildViewMarkdown } from '../../../lib/viewText'
import { exportFilename } from '../../../lib/exportFilename'
import type {
  ResumeView, ViewStyle, SectionStyle, SectionDetail,
  ViewHeaderConfig, ViewFooterConfig,
} from '../../../types'
import {
  Trash2, ChevronUp, ChevronDown, GripVertical,
  ArrowLeft, Star, FileText, FileDown, FileType, FileCode,
  PanelRight, PanelRightClose, ExternalLink,
} from 'lucide-react'
import { DetailToggle, SectionStylePanel } from './SectionStylePanel'
import { Select } from './Select'
import { ViewStyleControls } from './ViewStyleControls'
import { ViewHeaderControls } from './ViewHeaderControls'
import { ViewFooterControls } from './ViewFooterControls'
import { Styles } from './Styles'

// ─── Content sections (excludes non-content + the skill/role registries) ─────
const CONTENT_SECTIONS = SECTIONS.filter(isExportableSection)

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

  // ── Live preview: rebuild HTML on view/data/locale changes, debounced ──
  const [previewHtml, setPreviewHtml] = useState(() =>
    buildViewHtml(data, view, exportLocale)
  )
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const popoutRef = useRef<Window | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setPreviewHtml(buildViewHtml(data, view, exportLocale))
    }, 250)
    return () => window.clearTimeout(t)
  }, [data, view, exportLocale])

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
    const onLoad = () => {
      measure()
      refine = window.setTimeout(measure, 400) // re-measure once webfonts settle
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

  const setSectionDetail = (key: string, detail: SectionDetail) => {
    onUpdate({
      sections: sections.map((s) =>
        s.key === key ? { ...s, detail } : s
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
  const [exportError, setExportError] = useState<string | null>(null)

  const handleExport = () => {
    setExportError(null)
    const html = buildViewHtml(data, view, exportLocale)
    const win = window.open('', '_blank')
    if (!win) { setExportError('Please allow pop-ups to export the PDF.'); return }
    win.document.write(html)
    win.document.close()
    // Print only once the self-hosted brand fonts have loaded, so the pages
    // aren't measured with fallback-font metrics (wrong line breaks / page
    // count). Cap the wait so a slow or blocked font load still prints.
    let printed = false
    const doPrint = () => { if (printed) return; printed = true; try { win.focus(); win.print() } catch { /* window closed */ } }
    const fonts = (win.document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
    if (fonts?.ready) fonts.ready.then(doPrint, doPrint)
    window.setTimeout(doPrint, 1500) // fallback ceiling
    onUpdate({ last_exported_at: new Date().toISOString() })
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
      await exportDocx(data, view, exportLocale)
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

      <div className={`rv-editor-grid${showPreview ? '' : ' rv-grid-solo'}`}>
        <div className="rv-editor-controls">

      {/* ── Name ── */}
      <div className="rv-section-block">
        <label className="rv-field-label" htmlFor="rv-name-input">View name</label>
        <input
          id="rv-name-input"
          className="rv-name-input"
          value={view.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="e.g. Board CV, Consultant CV…"
        />
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
            // editor's order (and, for date modes, the export order).
            const storeItems = vs.key === 'technology_categories'
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

                <div className="rv-sec-content">
                  <div className="rv-sec-top">
                    <div className="rv-sec-title-line">
                      <span className="rv-sec-title">{def.label}</span>
                      <span className="rv-sec-count">
                        {off
                          ? 'omitted'
                          : `${storeItems.filter((it) => !view.excluded_item_ids.includes(it.id)).length}/${storeItems.length}`}
                      </span>
                    </div>
                    <DetailToggle
                      value={vs.detail}
                      onChange={(d) => setSectionDetail(vs.key, d)}
                    />
                  </div>

                  {!off && (
                    <SectionStylePanel
                      sectionKey={vs.key}
                      style={vs.style}
                      onChange={(patch) => setSectionStyle(vs.key, patch)}
                      onReset={() => setSectionStyle(vs.key, null)}
                      hasStyle={hasStyle}
                    />
                  )}

                  {!off && storeItems.length > 0 && (
                    <div className="rv-item-list">
                      {storeItems.map((item) => {
                        const excluded = view.excluded_item_ids.includes(item.id)
                        const title = getItemTitle(vs.key, item, primaryLocale)
                        const subtitle = getItemSubtitle(vs.key, item, primaryLocale)
                        return (
                          <label key={item.id} className={`rv-item-row ${excluded ? 'rv-item-hidden' : ''}`}>
                            <input
                              type="checkbox"
                              checked={!excluded}
                              onChange={() => toggleItem(item.id)}
                              className="rv-item-check"
                            />
                            <span className="rv-item-info">
                              <span className="rv-item-title">{title}</span>
                              {item.starred && <Star size={11} className="rv-item-star" />}
                              {subtitle && <span className="rv-item-sub">{subtitle}</span>}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {!off && storeItems.length === 0 && (
                    <div className="rv-item-empty">No items in master CV</div>
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

      {/* ── Export ── */}
      <div className="rv-section-block rv-export-block">
        <div className="rv-block-heading">Export</div>
        <div className="rv-export-row">
          <select
            className="rv-locale-select"
            aria-label="Export language"
            value={exportLocale}
            onChange={(e) => changeExportLocale(e.target.value)}
          >
            {locales.map((lc) => (
              <option key={lc} value={lc}>
                {LOCALE_LABELS[lc]?.flag} {LOCALE_LABELS[lc]?.name ?? lc}
              </option>
            ))}
          </select>
          <button className="rv-export-btn" onClick={handleExport}>
            <FileText size={15} /> Export PDF
          </button>
          <button
            className="rv-export-btn rv-export-docx"
            onClick={() => void handleExportDocx()}
            disabled={docxBusy}
            title="Generate a Microsoft Word (.docx) file"
          >
            <FileDown size={15} /> {docxBusy ? 'Building…' : 'Export DOCX'}
          </button>
          <button
            className="rv-export-btn rv-export-ats"
            onClick={() => handleExportTextual('txt')}
            title="Plain text — for ATS systems and online application forms"
          >
            <FileType size={15} /> Text
          </button>
          <button
            className="rv-export-btn rv-export-ats"
            onClick={() => handleExportTextual('md')}
            title="Markdown — for LinkedIn, email, or further editing"
          >
            <FileCode size={15} /> Markdown
          </button>
        </div>
        {view.last_exported_at && (
          <div className="rv-last-export">
            Last exported {new Date(view.last_exported_at).toLocaleDateString()}
          </div>
        )}
        {exportError && (
          <div className="rv-export-error" role="alert">
            {exportError}
            <button className="rv-export-error-x" onClick={() => setExportError(null)} aria-label="Dismiss">×</button>
          </div>
        )}
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
