import { useEffect, useRef, useState } from 'react'
import { useStore, newId } from '../../store/useStore'
import { DualField } from '../ui/DualField'
import { ImageField } from '../ui/ImageField'
import { SECTIONS } from '../../lib/sections'
import { LOCALE_LABELS, resolve } from '../../lib/locales'
import {
  buildViewSections, reorderViewSections, isExportableSection,
  getItemTitle, getItemSubtitle, buildViewHtml, normalizeViewSections,
  defaultViewDetail,
} from '../../lib/viewFilter'
import { DEFAULT_VIEW_STYLE } from '../../lib/viewStyle'
import {
  DEFAULT_VIEW_HEADER, DEFAULT_VIEW_FOOTER, withHeaderDefaults, withFooterDefaults,
  defaultHeaderFields,
} from '../../lib/viewHeader'
import type {
  ResumeView, ViewStyle, SectionStyle, SectionDetail,
  Density, BodySize, HeadingFont, PageMargin, TagStyle,
  ViewHeaderConfig, ViewFooterConfig, HeaderField, HeaderTextStyle,
  PhotoPlacement, LogoPlacement, FooterSeparator, CopyrightHolder,
} from '../../types'
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  ArrowLeft, LayoutList, Star, FileText, FileDown,
  Sliders, RotateCcw, PanelRight, PanelRightClose, ExternalLink,
} from 'lucide-react'

// ─── Header field display labels ──────────────────────────────────────────────
const HEADER_FIELD_LABELS: Record<HeaderField['key'], string> = {
  phone: 'Phone',
  email: 'Email',
  location: 'Location',
  nationality: 'Nationality',
  date_of_birth: 'Date of birth',
  linkedin: 'LinkedIn',
  website: 'Website',
  twitter: 'Twitter / X',
  languages: 'Languages summary',
}

// ─── Content sections (excludes non-content + the skill/role registries) ─────
const CONTENT_SECTIONS = SECTIONS.filter(isExportableSection)

// ─── Main component ───────────────────────────────────────────────────────────

export function ResumeViewsEditor() {
  // activeViewId lives in the store so the sidebar can deep-link a view.
  const { data, addItem, removeItem, updateItem, activeViewId, setActiveView } = useStore()

  const views = data.views

  const createView = () => {
    const now = new Date().toISOString()
    const view: ResumeView = {
      id: newId(),
      name: 'New View',
      introduction: {},
      sections: buildViewSections(),
      excluded_item_ids: [],
      include_photo: false,
      starred_only: false,
      page_limit: null,
      template_id: null,
      style: { ...DEFAULT_VIEW_STYLE },
      header: { ...DEFAULT_VIEW_HEADER, fields: defaultHeaderFields() },
      footer: { ...DEFAULT_VIEW_FOOTER, copyright_custom: {}, note: {} },
      last_exported_at: null,
      created_at: now,
      updated_at: now,
    }
    addItem('views', view)
    setActiveView(view.id)
  }

  const deleteView = (id: string) => {
    if (activeViewId === id) setActiveView(null)
    removeItem('views', id)
  }

  if (activeViewId !== null) {
    const view = views.find((v) => v.id === activeViewId)
    if (!view) { setActiveView(null); return null }
    return (
      <ViewEditor
        view={view}
        onBack={() => setActiveView(null)}
        onDelete={() => deleteView(view.id)}
        onUpdate={(patch) => updateItem('views', view.id, patch)}
      />
    )
  }

  return <ViewList views={views} onCreate={createView} onEdit={setActiveView} onDelete={deleteView} />
}

// ─── View list ────────────────────────────────────────────────────────────────

function ViewList({ views, onCreate, onEdit, onDelete }: {
  views: ResumeView[]
  onCreate: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="rv-pane">
      <div className="rv-list-intro">
        <p>
          A Resume View is a curated subset of your master CV — choose which sections
          and items appear, write a custom introduction, then export as a targeted document.
          Use views to produce a Board CV, a Consultant project CV, an Employment history,
          or any other variant from the same data.
        </p>
        <button className="rv-create-btn" onClick={onCreate}>
          <Plus size={15} /> New View
        </button>
      </div>

      {views.length === 0 ? (
        <div className="rv-empty">
          <LayoutList size={36} />
          <p>No views yet.</p>
          <p className="rv-empty-sub">Create your first view to extract a targeted resume.</p>
        </div>
      ) : (
        <div className="rv-cards">
          {views.map((v) => {
            const full = v.sections.filter((s) => s.detail === 'full').length
            const summary = v.sections.filter((s) => s.detail === 'summary').length
            const hidden = v.excluded_item_ids.length
            return (
              <div key={v.id} className="rv-card">
                <div className="rv-card-icon"><LayoutList size={20} /></div>
                <div className="rv-card-body">
                  <div className="rv-card-name">{v.name}</div>
                  <div className="rv-card-meta">
                    {full} full
                    {summary > 0 ? ` · ${summary} summary` : ''}
                    {hidden > 0 ? ` · ${hidden} item${hidden !== 1 ? 's' : ''} hidden` : ''}
                    {v.starred_only ? ' · starred only' : ''}
                  </div>
                </div>
                <div className="rv-card-actions">
                  <button className="rv-btn-edit" onClick={() => onEdit(v.id)}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button className="rv-btn-del" onClick={() => onDelete(v.id)} title="Delete view">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Styles />
    </div>
  )
}

// ─── View editor ──────────────────────────────────────────────────────────────

function ViewEditor({ view, onBack, onDelete, onUpdate }: {
  view: ResumeView
  onBack: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<ResumeView>) => void
}) {
  const { data, primaryLocale } = useStore()
  const [exportLocale, setExportLocale] = useState(
    data.resume?.supported_locales?.[0] ?? primaryLocale
  )

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
    if (!win) { alert('Please allow pop-ups to open the preview window.'); return }
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

  const handleExport = () => {
    const html = buildViewHtml(data, view, exportLocale)
    const win = window.open('', '_blank')
    if (!win) { alert('Please allow pop-ups to export.'); return }
    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 600)
    onUpdate({ last_exported_at: new Date().toISOString() })
  }

  // The docx library is ~400 kB — lazy-load only when the user clicks Export DOCX.
  const handleExportDocx = async () => {
    setDocxBusy(true)
    try {
      const { exportDocx } = await import('../../lib/exporter')
      await exportDocx(data, view, exportLocale)
      onUpdate({ last_exported_at: new Date().toISOString() })
    } catch (e) {
      alert(`Could not export DOCX: ${(e as Error).message}`)
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
        <label className="rv-field-label">View name</label>
        <input
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
          onChange={updateHeader}
        />
      </div>

      {/* ── Styling ── */}
      <div className="rv-section-block">
        <div className="rv-block-heading">View styling</div>
        <p className="rv-block-desc">
          Visual personality for the whole exported document. Per-section
          overrides live on each section below.
        </p>
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
          {sections.map((vs, idx) => {
            const def = CONTENT_SECTIONS.find((s) => s.key === vs.key)
            if (!def || !def.storeKey) return null
            const storeItems = (data[def.storeKey] as Array<{ id: string; disabled?: boolean; starred?: boolean }>)
              .filter((it) => !it.disabled)
              // Promoted Projects only lists the starred projects (its source set).
              .filter((it) => vs.key !== 'promoted_projects' || it.starred)

            const off = vs.detail === 'off'
            const hasStyle = !!vs.style && Object.keys(vs.style).length > 0

            return (
              <div key={vs.key} className={`rv-sec-row ${off ? 'rv-sec-off' : 'rv-sec-on'}`}>
                <div className="rv-sec-controls">
                  <button className="rv-ord-btn" onClick={() => moveSection(vs.key, 'up')} disabled={idx === 0}>
                    <ChevronUp size={14} />
                  </button>
                  <button className="rv-ord-btn" onClick={() => moveSection(vs.key, 'down')} disabled={idx === sections.length - 1}>
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

                  {!off && vs.detail === 'full' && storeItems.length > 0 && (
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
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Options ── */}
      <div className="rv-section-block">
        <div className="rv-block-heading">Options</div>
        <div className="rv-options-row">
          <label className="rv-opt-check">
            <input
              type="checkbox"
              checked={view.starred_only}
              onChange={(e) => onUpdate({ starred_only: e.target.checked })}
            />
            Starred items only
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
            value={exportLocale}
            onChange={(e) => setExportLocale(e.target.value)}
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
        </div>
        {view.last_exported_at && (
          <div className="rv-last-export">
            Last exported {new Date(view.last_exported_at).toLocaleDateString()}
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

// ─── Shared styles ────────────────────────────────────────────────────────────

function Styles() {
  return (
    <style>{`
      .rv-pane { animation: fadeUp .25s ease; }

      /* ── List view ── */
      .rv-list-intro {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
        margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--line);
      }
      .rv-list-intro p { font-size: 14px; color: var(--ink-soft); max-width: 620px; line-height: 1.6; }
      .rv-create-btn {
        display: inline-flex; align-items: center; gap: 7px; padding: 10px 18px;
        background: var(--accent); color: #fff; border-radius: var(--r-md);
        font-weight: 600; font-size: 14px; white-space: nowrap; transition: background .15s; flex-shrink: 0;
      }
      .rv-create-btn:hover { background: var(--accent-bright); }

      .rv-empty {
        text-align: center; padding: 60px 20px; color: var(--ink-faint);
        display: flex; flex-direction: column; align-items: center; gap: 10px;
      }
      .rv-empty p { font-size: 15px; }
      .rv-empty-sub { font-size: 13px; }

      .rv-cards { display: flex; flex-direction: column; gap: 10px; }
      .rv-card {
        display: flex; align-items: center; gap: 14px; padding: 16px 18px;
        background: var(--paper-raised); border: 1px solid var(--line);
        border-radius: var(--r-md); transition: border-color .15s;
      }
      .rv-card:hover { border-color: var(--accent); }
      .rv-card-icon { color: var(--accent); flex-shrink: 0; }
      .rv-card-body { flex: 1; min-width: 0; }
      .rv-card-name { font-weight: 600; font-size: 15px; }
      .rv-card-meta { font-size: 12px; color: var(--ink-faint); margin-top: 2px; }
      .rv-card-actions { display: flex; align-items: center; gap: 8px; }

      /* ── Shared buttons ── */
      .rv-btn-edit {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px;
        background: var(--accent-wash); color: var(--accent); border-radius: var(--r-sm);
        font-size: 13px; font-weight: 600; transition: all .13s;
      }
      .rv-btn-edit:hover { background: var(--accent); color: #fff; }
      .rv-btn-del {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 7px; border-radius: var(--r-sm); color: var(--ink-faint);
        transition: all .13s; font-size: 13px;
      }
      .rv-btn-del:hover { background: #fee2e2; color: #b91c1c; }

      /* ── Editor header ── */
      .rv-editor-header {
        display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
        padding-bottom: 20px; border-bottom: 1px solid var(--line);
      }
      .rv-back-btn {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
        background: var(--paper-sunken); border-radius: var(--r-sm);
        font-size: 13px; color: var(--ink-soft); transition: all .13s;
      }
      .rv-back-btn:hover { color: var(--accent); }
      .rv-editor-stats { flex: 1; font-size: 13px; color: var(--ink-faint); }
      .rv-del-view { gap: 6px; padding: 7px 12px; font-size: 13px; }
      .rv-preview-controls { display: flex; align-items: center; gap: 6px; }
      .rv-prev-ctrl {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
        background: var(--paper-sunken); border: 1px solid var(--line); border-radius: var(--r-sm);
        font-size: 12.5px; font-weight: 600; color: var(--ink-soft); transition: all .13s;
      }
      .rv-prev-ctrl:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }

      /* ── Field blocks ── */
      .rv-section-block {
        margin-bottom: 32px; padding-bottom: 32px; border-bottom: 1px solid var(--line);
      }
      .rv-section-block:last-child { border-bottom: none; }
      .rv-block-heading {
        font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
        color: var(--ink-faint); margin-bottom: 6px;
      }
      .rv-block-desc { font-size: 13px; color: var(--ink-soft); margin-bottom: 14px; }
      .rv-field-label {
        display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
        text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
      }
      .rv-name-input {
        width: 100%; padding: 9px 11px; background: var(--paper-raised);
        border: 1px solid var(--line); border-radius: var(--r-sm);
        font-size: 15px; font-weight: 600; transition: border-color .15s, box-shadow .15s;
      }
      .rv-name-input:focus {
        outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash);
      }

      /* ── Section list ── */
      .rv-section-list { display: flex; flex-direction: column; gap: 6px; }
      .rv-sec-row {
        display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px;
        border: 1px solid var(--line); border-radius: var(--r-md);
        background: var(--paper-raised); transition: border-color .15s;
      }
      .rv-sec-on { border-color: var(--line); }
      .rv-sec-off { opacity: .55; background: var(--paper-sunken); }

      .rv-sec-controls { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; padding-top: 2px; }
      .rv-ord-btn {
        display: flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border-radius: var(--r-sm);
        color: var(--ink-faint); transition: all .13s;
      }
      .rv-ord-btn:hover:not(:disabled) { background: var(--paper-sunken); color: var(--ink); }
      .rv-ord-btn:disabled { opacity: .25; cursor: default; }

      .rv-sec-content { flex: 1; min-width: 0; }
      .rv-sec-top {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; flex-wrap: wrap;
      }
      .rv-sec-title-line { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
      .rv-sec-title { font-weight: 600; font-size: 14px; }
      .rv-sec-count {
        font-size: 11px; font-weight: 500; padding: 1px 7px;
        background: var(--paper-sunken); color: var(--ink-faint); border-radius: 10px;
      }

      /* ── Detail segmented control ── */
      .rv-detail-toggle {
        display: inline-flex; align-items: stretch; background: var(--paper-sunken);
        border: 1px solid var(--line); border-radius: var(--r-sm); padding: 2px;
        gap: 1px;
      }
      .rv-detail-opt {
        padding: 4px 10px; font-size: 11px; font-weight: 600; letter-spacing: .04em;
        text-transform: uppercase; color: var(--ink-faint);
        border-radius: 3px; transition: all .13s; min-width: 56px; text-align: center;
      }
      .rv-detail-opt:hover { color: var(--accent); }
      .rv-detail-opt.is-active {
        background: var(--accent); color: #fff;
      }
      .rv-detail-opt.is-active:hover { color: #fff; }

      /* ── Section style panel ── */
      .rv-secstyle {
        margin-top: 8px; padding: 9px 11px;
        background: var(--paper-sunken); border-radius: var(--r-sm);
      }
      .rv-secstyle-summary {
        display: flex; align-items: center; gap: 7px; cursor: pointer;
        font-size: 11px; font-weight: 600; color: var(--ink-soft);
        letter-spacing: .04em; text-transform: uppercase;
        list-style: none; user-select: none;
      }
      .rv-secstyle-summary::-webkit-details-marker { display: none; }
      .rv-secstyle-summary:hover { color: var(--accent); }
      .rv-secstyle-summary .rv-secstyle-badge {
        font-size: 9px; padding: 1px 6px; border-radius: 9px;
        background: var(--accent-wash); color: var(--accent); font-weight: 700;
        letter-spacing: .04em;
      }
      .rv-secstyle-summary .rv-secstyle-reset {
        margin-left: auto; padding: 2px 6px; border-radius: var(--r-sm);
        color: var(--ink-faint); display: inline-flex; align-items: center; gap: 3px;
        font-size: 10px; font-weight: 600;
      }
      .rv-secstyle-summary .rv-secstyle-reset:hover { color: var(--accent); background: var(--paper); }
      .rv-secstyle-body { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; margin-top: 10px; }
      .rv-secstyle-row {
        display: flex; align-items: center; justify-content: space-between; gap: 6px;
        font-size: 12px; color: var(--ink-soft);
      }
      .rv-secstyle-row select, .rv-secstyle-row input[type=checkbox] {
        font-size: 12px;
      }
      .rv-secstyle-row select {
        padding: 3px 6px; border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper); min-width: 90px;
      }

      /* ── View styling block ── */
      .rv-vs-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
      }
      .rv-vs-field { display: flex; flex-direction: column; gap: 5px; }
      .rv-vs-label {
        font-size: 10px; font-weight: 700; letter-spacing: .08em;
        text-transform: uppercase; color: var(--ink-faint);
      }
      .rv-vs-select, .rv-vs-color {
        padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper-raised); font-size: 14px;
      }
      .rv-vs-select:focus, .rv-vs-color:focus {
        outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash);
      }
      .rv-vs-color-row { display: flex; align-items: center; gap: 8px; }
      .rv-vs-color { padding: 4px; width: 44px; height: 32px; cursor: pointer; }
      .rv-vs-hex {
        padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper-raised); font-family: monospace; font-size: 13px;
        width: 96px;
      }
      .rv-vs-reset {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 7px 12px; border-radius: var(--r-sm);
        background: var(--paper-sunken); color: var(--ink-soft);
        font-size: 12px; font-weight: 600; transition: all .13s; margin-top: 10px;
      }
      .rv-vs-reset:hover { color: var(--accent); background: var(--accent-wash); }

      /* ── Header controls ── */
      .rv-hdr-sub {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
        color: var(--ink-faint); margin: 18px 0 10px; padding-top: 14px;
        border-top: 1px solid var(--line);
      }
      .rv-hdr > .rv-hdr-sub:first-child { margin-top: 0; padding-top: 0; border-top: none; }
      .rv-hdr-note { font-size: 12px; color: var(--ink-soft); margin-bottom: 10px; line-height: 1.5; }
      .rv-hdr-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .rv-hdr-type { display: flex; flex-direction: column; gap: 5px; }
      .rv-hdr-type-row { display: flex; align-items: center; gap: 6px; }
      .rv-hdr-type-row .rv-vs-select { flex: 1; min-width: 0; }
      .rv-hdr-size {
        width: 70px; padding: 7px 8px; border: 1px solid var(--line);
        border-radius: var(--r-sm); background: var(--paper-raised); font-size: 14px;
      }
      .rv-hdr-size:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
      .rv-hdr-pt { font-size: 12px; color: var(--ink-faint); }
      .rv-hdr-sep {
        display: inline-flex; align-items: center; gap: 6px; text-transform: none;
        letter-spacing: 0; font-weight: 600; font-size: 11px; color: var(--ink-soft);
      }
      .rv-hdr-sep-input {
        width: 48px; padding: 3px 6px; border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper); text-align: center; font-family: monospace; font-size: 13px;
      }
      .rv-hdr-fields { display: flex; flex-direction: column; gap: 4px; }
      .rv-hdr-field {
        display: flex; align-items: center; gap: 8px; padding: 5px 8px;
        border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper-raised);
      }
      .rv-hdr-field.is-off { opacity: .55; background: var(--paper-sunken); }
      .rv-hdr-ord { display: flex; flex-direction: column; flex-shrink: 0; }
      .rv-hdr-ord .rv-ord-btn { width: 20px; height: 16px; }
      .rv-hdr-show { display: inline-flex; align-items: center; flex-shrink: 0; }
      .rv-hdr-show input, .rv-hdr-sameline input { accent-color: var(--accent); }
      .rv-hdr-fname { font-size: 13px; font-weight: 500; width: 130px; flex-shrink: 0; }
      .rv-hdr-desc {
        flex: 1; min-width: 60px; padding: 5px 8px; border: 1px solid var(--line);
        border-radius: var(--r-sm); background: var(--paper); font-size: 13px;
      }
      .rv-hdr-desc:focus { outline: none; border-color: var(--accent); }
      .rv-hdr-desc:disabled { background: var(--paper-sunken); }
      .rv-hdr-sameline {
        display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
        font-size: 11.5px; color: var(--ink-soft); cursor: pointer;
      }
      .rv-hdr-img-grid {
        display: grid; grid-template-columns: minmax(150px, 200px) 1fr; gap: 16px; align-items: start;
      }
      .rv-hdr-img-grid .imgf-wrap { margin-bottom: 0; }

      /* ── Item list ── */
      .rv-item-list { display: flex; flex-direction: column; gap: 1px; margin-top: 10px; }
      .rv-item-row {
        display: flex; align-items: flex-start; gap: 10px; padding: 7px 8px;
        border-radius: var(--r-sm); cursor: pointer; transition: background .1s;
      }
      .rv-item-row:hover { background: var(--paper-sunken); }
      .rv-item-hidden { opacity: .45; }
      .rv-item-hidden .rv-item-title { text-decoration: line-through; }
      .rv-item-check { flex-shrink: 0; margin-top: 3px; accent-color: var(--accent); width: 15px; height: 15px; }
      .rv-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .rv-item-title { font-size: 13px; font-weight: 500; }
      .rv-item-star { color: var(--gold); flex-shrink: 0; }
      .rv-item-sub { font-size: 11px; color: var(--ink-faint); }
      .rv-item-empty { font-size: 12px; color: var(--ink-faint); padding: 6px 0 2px; font-style: italic; }

      /* ── Options ── */
      .rv-options-row { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
      .rv-opt-check {
        display: flex; align-items: center; gap: 7px; font-size: 14px; cursor: pointer;
      }
      .rv-opt-check input { accent-color: var(--accent); width: 15px; height: 15px; }
      .rv-opt-num { display: flex; align-items: center; gap: 8px; font-size: 14px; }
      .rv-page-input {
        width: 60px; padding: 6px 9px; background: var(--paper-raised);
        border: 1px solid var(--line); border-radius: var(--r-sm); text-align: center;
        font-size: 14px;
      }
      .rv-page-input:focus { outline: none; border-color: var(--accent); }

      /* ── Export ── */
      .rv-export-block { background: var(--accent-wash); border-radius: var(--r-md); padding: 20px 22px; border: none; }
      .rv-export-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .rv-locale-select {
        padding: 9px 12px; background: #fff; border: 1px solid var(--line);
        border-radius: var(--r-sm); font-size: 14px; min-width: 150px;
      }
      .rv-locale-select:focus { outline: none; border-color: var(--accent); }
      .rv-export-btn {
        display: inline-flex; align-items: center; gap: 7px; padding: 10px 20px;
        background: var(--accent); color: #fff; border-radius: var(--r-md);
        font-weight: 600; font-size: 14px; transition: background .15s;
      }
      .rv-export-btn:hover:not(:disabled) { background: var(--accent-bright); }
      .rv-export-btn:disabled { opacity: .6; cursor: progress; }
      .rv-export-docx {
        background: #fff; color: var(--accent); border: 1.5px solid var(--accent);
      }
      .rv-export-docx:hover:not(:disabled) { background: var(--accent-wash); color: var(--accent); }
      .rv-last-export { margin-top: 10px; font-size: 12px; color: var(--ink-faint); }

      /* ── Live preview pane ── */
      .rv-editor-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 28px;
        align-items: start;
      }
      /* Preview hidden → single, comfortably-bounded controls column. */
      .rv-grid-solo { grid-template-columns: minmax(0, 860px); }
      .rv-editor-controls { min-width: 0; }
      .rv-preview-pane {
        position: sticky;
        top: 16px;
        display: flex;
        flex-direction: column;
        height: calc(100vh - 32px);
        background: var(--paper-sunken);
        border: 1px solid var(--line);
        border-radius: var(--r-md);
        overflow: hidden;
      }
      .rv-preview-header {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 14px;
        background: var(--paper-raised);
        border-bottom: 1px solid var(--line);
      }
      .rv-preview-label {
        font-size: 11px; font-weight: 700; letter-spacing: .1em;
        text-transform: uppercase; color: var(--ink-faint);
      }
      .rv-preview-pages {
        margin-left: auto;
        font-size: 12px; color: var(--ink-soft);
        font-variant-numeric: tabular-nums;
      }
      .rv-preview-over { color: #b91c1c; font-weight: 600; }
      .rv-preview-head-actions { margin-left: auto; display: flex; align-items: center; gap: 2px; }
      .rv-preview-pages + .rv-preview-head-actions { margin-left: 10px; }
      .rv-preview-iconbtn {
        width: 28px; height: 26px; display: grid; place-items: center;
        border-radius: var(--r-sm); color: var(--ink-faint); transition: all .13s;
      }
      .rv-preview-iconbtn:hover { background: var(--accent-wash); color: var(--accent); }
      .rv-preview-frame {
        flex: 1; border: none; background: #fff; width: 100%;
      }
      @media (max-width: 1200px) {
        .rv-editor-grid { grid-template-columns: 1fr; }
        .rv-preview-pane { display: none; }
      }
    `}</style>
  )
}

// ─── Detail toggle ──────────────────────────────────────────────────────────

function DetailToggle({ value, onChange }: { value: SectionDetail; onChange: (d: SectionDetail) => void }) {
  const opts: SectionDetail[] = ['off', 'summary', 'full']
  return (
    <div className="rv-detail-toggle" role="radiogroup" aria-label="Section detail level">
      {opts.map((opt) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={value === opt}
          className={`rv-detail-opt ${value === opt ? 'is-active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

// ─── View styling controls ──────────────────────────────────────────────────

function ViewStyleControls({ style, onChange }: { style: ViewStyle; onChange: (patch: Partial<ViewStyle>) => void }) {
  const resetAll = () => onChange({ ...DEFAULT_VIEW_STYLE })
  return (
    <>
      <div className="rv-vs-grid">
        <Select<Density>
          label="Density"
          value={style.density}
          options={[
            ['compact',  'Compact'],
            ['normal',   'Normal'],
            ['spacious', 'Spacious'],
          ]}
          onChange={(density) => onChange({ density })}
        />
        <Select<BodySize>
          label="Body size"
          value={style.body_size}
          options={[
            ['small',  'Small (9pt)'],
            ['normal', 'Normal (11pt)'],
            ['large',  'Large (12pt)'],
          ]}
          onChange={(body_size) => onChange({ body_size })}
        />
        <Select<HeadingFont>
          label="Heading font"
          value={style.heading_font}
          options={[
            ['condensed', 'Condensed (Cartavio)'],
            ['sans',      'Sans (Ubuntu)'],
            ['serif',     'Serif (Georgia)'],
          ]}
          onChange={(heading_font) => onChange({ heading_font })}
        />
        <Select<PageMargin>
          label="Page margins"
          value={style.page_margin}
          options={[
            ['tight',    'Tight'],
            ['normal',   'Normal'],
            ['generous', 'Generous'],
          ]}
          onChange={(page_margin) => onChange({ page_margin })}
        />
        <Select<TagStyle>
          label="Skill tags"
          value={style.tag_style}
          options={[
            ['chips',  'Chips'],
            ['inline', 'Inline list'],
          ]}
          onChange={(tag_style) => onChange({ tag_style })}
        />
        <div className="rv-vs-field">
          <span className="rv-vs-label">Accent colour</span>
          <div className="rv-vs-color-row">
            <input
              type="color"
              className="rv-vs-color"
              value={style.accent_color}
              onChange={(e) => onChange({ accent_color: e.target.value })}
            />
            <input
              type="text"
              className="rv-vs-hex"
              value={style.accent_color}
              onChange={(e) => {
                const v = e.target.value.trim()
                if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange({ accent_color: v })
              }}
            />
          </div>
        </div>
      </div>
      <button type="button" className="rv-vs-reset" onClick={resetAll}>
        <RotateCcw size={12} /> Reset to defaults
      </button>
    </>
  )
}

function Select<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
}) {
  return (
    <label className="rv-vs-field">
      <span className="rv-vs-label">{label}</span>
      <select className="rv-vs-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

// ─── View header controls ────────────────────────────────────────────────────

function ViewHeaderControls({
  header, primaryLocale, masterPhoto, masterLogo, onChange,
}: {
  header: ViewHeaderConfig
  primaryLocale: string
  masterPhoto: string | null
  masterLogo: string | null
  onChange: (patch: Partial<ViewHeaderConfig>) => void
}) {
  const fields = [...header.fields].sort((a, b) => a.sort_order - b.sort_order)

  const setField = (key: HeaderField['key'], patch: Partial<HeaderField>) => {
    onChange({ fields: header.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) })
  }
  const setLabel = (key: HeaderField['key'], text: string) => {
    const f = header.fields.find((x) => x.key === key)
    if (!f) return
    const label = { ...f.label }
    if (text) label[primaryLocale] = text
    else delete label[primaryLocale]
    setField(key, { label })
  }
  const moveField = (key: HeaderField['key'], dir: 'up' | 'down') => {
    const sorted = [...header.fields].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex((f) => f.key === key)
    const swap = dir === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || swap < 0 || swap >= sorted.length) return
    ;[sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]]
    onChange({ fields: sorted.map((f, i) => ({ ...f, sort_order: i })) })
  }

  return (
    <div className="rv-hdr">
      {/* Typography */}
      <div className="rv-hdr-sub">Typography</div>
      <div className="rv-hdr-type-grid">
        <HeaderTextStyleControl
          label="Name" value={header.name_style} autoLabel="Auto (large)"
          onChange={(name_style) => onChange({ name_style })}
        />
        <HeaderTextStyleControl
          label="Title" value={header.title_style} autoLabel="Auto"
          onChange={(title_style) => onChange({ title_style })}
        />
      </div>

      {/* Detail rows */}
      <div className="rv-hdr-sub">
        Detail rows
        <label className="rv-hdr-sep">
          Separator
          <input
            className="rv-hdr-sep-input"
            value={header.separator}
            onChange={(e) => onChange({ separator: e.target.value })}
            maxLength={5}
          />
        </label>
      </div>
      <p className="rv-hdr-note">
        Toggle which rows show, edit the descriptor text (in your primary
        language), and choose whether each shares the previous row's line.
      </p>
      <div className="rv-hdr-fields">
        {fields.map((f, idx) => (
          <div key={f.key} className={`rv-hdr-field ${f.show ? '' : 'is-off'}`}>
            <div className="rv-hdr-ord">
              <button className="rv-ord-btn" onClick={() => moveField(f.key, 'up')} disabled={idx === 0} aria-label="Move up">
                <ChevronUp size={13} />
              </button>
              <button className="rv-ord-btn" onClick={() => moveField(f.key, 'down')} disabled={idx === fields.length - 1} aria-label="Move down">
                <ChevronDown size={13} />
              </button>
            </div>
            <label className="rv-hdr-show" title="Show this row">
              <input type="checkbox" checked={f.show} onChange={(e) => setField(f.key, { show: e.target.checked })} />
            </label>
            <span className="rv-hdr-fname">{HEADER_FIELD_LABELS[f.key]}</span>
            <input
              className="rv-hdr-desc"
              value={f.label[primaryLocale] ?? ''}
              placeholder="descriptor…"
              disabled={!f.show}
              onChange={(e) => setLabel(f.key, e.target.value)}
            />
            <label className="rv-hdr-sameline" title="Render on the same line as the previous row">
              <input
                type="checkbox"
                checked={f.same_line}
                disabled={!f.show || idx === 0}
                onChange={(e) => setField(f.key, { same_line: e.target.checked })}
              />
              same line
            </label>
          </div>
        ))}
      </div>

      {/* Photo */}
      <div className="rv-hdr-sub">Profile photo</div>
      <div className="rv-hdr-img-grid">
        <Select<PhotoPlacement>
          label="Placement"
          value={header.photo_placement}
          options={[
            ['none', 'Hidden'],
            ['left', 'Left of details'],
            ['right', 'Right of details'],
            ['above', 'Above details'],
            ['below', 'Below details'],
          ]}
          onChange={(photo_placement) => onChange({ photo_placement })}
        />
        <div className="rv-hdr-override">
          <ImageField
            label="Photo override (this view)"
            value={header.photo_override}
            onChange={(photo_override) => onChange({ photo_override })}
            format="jpeg"
            maxDim={600}
            shape="square"
            hint={masterPhoto ? 'Leave empty to use the master photo.' : 'No master photo set — upload one here or in Personal Details.'}
          />
        </div>
      </div>

      {/* Logo */}
      <div className="rv-hdr-sub">Company logo</div>
      <div className="rv-hdr-img-grid">
        <Select<LogoPlacement>
          label="Placement"
          value={header.logo_placement}
          options={[
            ['none', 'Hidden'],
            ['left', 'Top left'],
            ['center', 'Top center'],
            ['right', 'Top right'],
          ]}
          onChange={(logo_placement) => onChange({ logo_placement })}
        />
        <div className="rv-hdr-override">
          <ImageField
            label="Logo override (this view)"
            value={header.logo_override}
            onChange={(logo_override) => onChange({ logo_override })}
            format="png"
            maxDim={600}
            shape="wide"
            hint={masterLogo ? 'Leave empty to use the master logo.' : 'No master logo set — upload one here or in Personal Details.'}
          />
        </div>
      </div>
    </div>
  )
}

function HeaderTextStyleControl({
  label, value, autoLabel, onChange,
}: {
  label: string
  value: HeaderTextStyle
  autoLabel: string
  onChange: (v: HeaderTextStyle) => void
}) {
  return (
    <div className="rv-hdr-type">
      <span className="rv-vs-label">{label}</span>
      <div className="rv-hdr-type-row">
        <select
          className="rv-vs-select"
          value={value.font}
          onChange={(e) => onChange({ ...value, font: e.target.value as HeaderTextStyle['font'] })}
        >
          <option value="condensed">Condensed</option>
          <option value="sans">Sans (Ubuntu)</option>
          <option value="serif">Serif (Georgia)</option>
          <option value="body">Body font</option>
        </select>
        <input
          className="rv-hdr-size"
          type="number"
          min={6} max={72}
          value={value.size_pt ?? ''}
          placeholder={autoLabel}
          title="Font size in points (blank = automatic)"
          onChange={(e) => onChange({ ...value, size_pt: e.target.value ? parseInt(e.target.value) : null })}
        />
        <span className="rv-hdr-pt">pt</span>
      </div>
    </div>
  )
}

// ─── View footer controls ────────────────────────────────────────────────────

function ViewFooterControls({
  footer, hasCompany, onChange,
}: {
  footer: ViewFooterConfig
  hasCompany: boolean
  onChange: (patch: Partial<ViewFooterConfig>) => void
}) {
  return (
    <>
      <div className="rv-vs-grid">
        <Select<FooterSeparator>
          label="Closing separator"
          value={footer.separator}
          options={[
            ['none', 'None'],
            ['line', 'Thin line'],
            ['thick', 'Thick line'],
            ['double', 'Double line'],
            ['dotted', 'Dotted'],
            ['dashed', 'Dashed'],
          ]}
          onChange={(separator) => onChange({ separator })}
        />
        <Select<CopyrightHolder>
          label="Copyright statement"
          value={footer.copyright}
          options={[
            ['none', 'None'],
            ['person', 'Your name'],
            ['company', hasCompany ? 'Company name' : 'Company (not set)'],
            ['custom', 'Custom…'],
          ]}
          onChange={(copyright) => onChange({ copyright })}
        />
      </div>
      {footer.copyright === 'company' && !hasCompany && (
        <p className="rv-hdr-note" style={{ color: '#b45309' }}>
          No company name is set in Personal Details — the copyright line will be
          omitted until you add one.
        </p>
      )}
      {footer.copyright === 'custom' && (
        <div style={{ marginTop: 12 }}>
          <DualField
            label="Custom copyright holder (this view)"
            value={footer.copyright_custom}
            onChange={(copyright_custom) => onChange({ copyright_custom })}
            placeholder="e.g. Another Consultancy AS"
          />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <DualField
          label="Footer note (optional)"
          value={footer.note}
          onChange={(note) => onChange({ note })}
          placeholder="e.g. Confidential — do not distribute"
        />
      </div>
    </>
  )
}

// ─── Per-section style panel (collapsed by default) ─────────────────────────

interface SectionStylePanelProps {
  sectionKey: string
  style: SectionStyle | undefined
  onChange: (patch: SectionStyle) => void
  onReset: () => void
  hasStyle: boolean
}

function SectionStylePanel({ style, onChange, onReset, hasStyle }: SectionStylePanelProps) {
  const s: SectionStyle = style ?? {}
  return (
    <details className="rv-secstyle">
      <summary className="rv-secstyle-summary">
        <Sliders size={11} /> Style overrides
        {hasStyle && <span className="rv-secstyle-badge">custom</span>}
        {hasStyle && (
          <button
            type="button"
            className="rv-secstyle-reset"
            onClick={(e) => { e.preventDefault(); onReset() }}
            title="Use view defaults for this section"
          >
            <RotateCcw size={10} /> Reset
          </button>
        )}
      </summary>
      <div className="rv-secstyle-body">
        <div className="rv-secstyle-row">
          <span>Density</span>
          <select
            value={s.density ?? ''}
            onChange={(e) => onChange({ density: (e.target.value || undefined) as Density | undefined })}
          >
            <option value="">— view default —</option>
            <option value="compact">Compact</option>
            <option value="normal">Normal</option>
            <option value="spacious">Spacious</option>
          </select>
        </div>
        <div className="rv-secstyle-row">
          <span>Tag style</span>
          <select
            value={s.tag_style ?? ''}
            onChange={(e) => onChange({ tag_style: (e.target.value || undefined) as TagStyle | undefined })}
          >
            <option value="">— view default —</option>
            <option value="chips">Chips</option>
            <option value="inline">Inline list</option>
          </select>
        </div>
        <label className="rv-secstyle-row">
          <span>Hide section heading</span>
          <input
            type="checkbox"
            checked={!!s.hide_heading}
            onChange={(e) => onChange({ hide_heading: e.target.checked || undefined })}
          />
        </label>
        <label className="rv-secstyle-row">
          <span>Hide dates</span>
          <input
            type="checkbox"
            checked={!!s.hide_dates}
            onChange={(e) => onChange({ hide_dates: e.target.checked || undefined })}
          />
        </label>
        <label className="rv-secstyle-row">
          <span>Item dividers</span>
          <select
            value={s.item_divider === undefined ? '' : s.item_divider ? 'on' : 'off'}
            onChange={(e) => {
              const v = e.target.value
              onChange({ item_divider: v === '' ? undefined : v === 'on' })
            }}
          >
            <option value="">— view default —</option>
            <option value="on">Show</option>
            <option value="off">Hide</option>
          </select>
        </label>
      </div>
    </details>
  )
}
