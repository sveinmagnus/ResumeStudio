import { useEffect, useRef, useState } from 'react'
import { useStore, newId } from '../../store/useStore'
import { DualField } from '../ui/DualField'
import { SECTIONS } from '../../lib/sections'
import { LOCALE_LABELS, resolve } from '../../lib/locales'
import {
  buildViewSections, reorderViewSections,
  getItemTitle, getItemSubtitle, buildViewHtml,
} from '../../lib/viewFilter'
import type { ResumeView, ViewSection } from '../../types'
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  ArrowLeft, LayoutList, Eye, EyeOff, Star, FileText, FileDown,
} from 'lucide-react'

// ─── Content sections (excludes non-content like overview, header, views) ─────
const CONTENT_SECTIONS = SECTIONS.filter((s) => s.storeKey && s.key !== 'views')

// ─── Main component ───────────────────────────────────────────────────────────

export function ResumeViewsEditor() {
  const { data, addItem, removeItem, updateItem } = useStore()
  const [activeViewId, setActiveViewId] = useState<string | null>(null)

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
      last_exported_at: null,
      created_at: now,
      updated_at: now,
    }
    addItem('views', view)
    setActiveViewId(view.id)
  }

  const deleteView = (id: string) => {
    if (activeViewId === id) setActiveViewId(null)
    removeItem('views', id)
  }

  if (activeViewId !== null) {
    const view = views.find((v) => v.id === activeViewId)
    if (!view) { setActiveViewId(null); return null }
    return (
      <ViewEditor
        view={view}
        onBack={() => setActiveViewId(null)}
        onDelete={() => deleteView(view.id)}
        onUpdate={(patch) => updateItem('views', view.id, patch)}
      />
    )
  }

  return <ViewList views={views} onCreate={createView} onEdit={setActiveViewId} onDelete={deleteView} />
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
            const enabled = v.sections.filter((s) => s.enabled).length
            const total = v.sections.length
            const hidden = v.excluded_item_ids.length
            return (
              <div key={v.id} className="rv-card">
                <div className="rv-card-icon"><LayoutList size={20} /></div>
                <div className="rv-card-body">
                  <div className="rv-card-name">{v.name}</div>
                  <div className="rv-card-meta">
                    {enabled}/{total} sections
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
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setPreviewHtml(buildViewHtml(data, view, exportLocale))
    }, 250)
    return () => window.clearTimeout(t)
  }, [data, view, exportLocale])

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

  const sections = [...view.sections].sort((a, b) => a.sort_order - b.sort_order)

  const toggleSection = (key: string) => {
    onUpdate({
      sections: view.sections.map((s) =>
        s.key === key ? { ...s, enabled: !s.enabled } : s
      ),
    })
  }

  const moveSection = (key: string, dir: 'up' | 'down') => {
    onUpdate({ sections: reorderViewSections(view.sections, key, dir) })
  }

  const toggleItem = (itemId: string) => {
    const ex = view.excluded_item_ids
    const next = ex.includes(itemId) ? ex.filter((id) => id !== itemId) : [...ex, itemId]
    onUpdate({ excluded_item_ids: next })
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
    if (!s.storeKey) return acc
    const vs = view.sections.find((v) => v.key === s.key)
    if (!vs?.enabled) return acc
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
        <button className="rv-btn-del rv-del-view" onClick={onDelete} title="Delete this view">
          <Trash2 size={14} /> Delete view
        </button>
      </div>

      <div className="rv-editor-grid">
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

      {/* ── Sections ── */}
      <div className="rv-section-block">
        <div className="rv-block-heading">Sections</div>
        <p className="rv-block-desc">Toggle sections on/off and reorder them for this view.</p>

        <div className="rv-section-list">
          {sections.map((vs, idx) => {
            const def = CONTENT_SECTIONS.find((s) => s.key === vs.key)
            if (!def || !def.storeKey) return null
            const storeItems = (data[def.storeKey] as Array<{ id: string; disabled?: boolean; starred?: boolean }>)
              .filter((it) => !it.disabled)

            return (
              <div key={vs.key} className={`rv-sec-row ${vs.enabled ? 'rv-sec-on' : 'rv-sec-off'}`}>
                <div className="rv-sec-controls">
                  <button className="rv-ord-btn" onClick={() => moveSection(vs.key, 'up')} disabled={idx === 0}>
                    <ChevronUp size={14} />
                  </button>
                  <button className="rv-ord-btn" onClick={() => moveSection(vs.key, 'down')} disabled={idx === sections.length - 1}>
                    <ChevronDown size={14} />
                  </button>
                </div>

                <button
                  className={`rv-sec-toggle ${vs.enabled ? 'rv-tog-on' : 'rv-tog-off'}`}
                  onClick={() => toggleSection(vs.key)}
                  title={vs.enabled ? 'Hide section' : 'Show section'}
                >
                  {vs.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>

                <div className="rv-sec-content">
                  <div className="rv-sec-title">
                    {def.label}
                    <span className="rv-sec-count">
                      {vs.enabled
                        ? `${storeItems.filter((it) => !view.excluded_item_ids.includes(it.id)).length}/${storeItems.length}`
                        : 'hidden'}
                    </span>
                  </div>

                  {vs.enabled && storeItems.length > 0 && (
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

                  {vs.enabled && storeItems.length === 0 && (
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
          <label className="rv-opt-check">
            <input
              type="checkbox"
              checked={view.include_photo}
              onChange={(e) => onUpdate({ include_photo: e.target.checked })}
            />
            Include photo
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

        <aside className="rv-preview-pane">
          <div className="rv-preview-header">
            <span className="rv-preview-label">Preview</span>
            {pageCount != null && (
              <span className={`rv-preview-pages${overLimit ? ' rv-preview-over' : ''}`}>
                ≈ {pageCount} page{pageCount !== 1 ? 's' : ''}
                {view.page_limit != null ? ` / ${view.page_limit}` : ''}
              </span>
            )}
          </div>
          <iframe
            ref={iframeRef}
            className="rv-preview-frame"
            srcDoc={previewHtml}
            title="Resume View preview"
          />
        </aside>
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

      .rv-sec-toggle {
        flex-shrink: 0; width: 30px; height: 30px; border-radius: var(--r-sm);
        display: flex; align-items: center; justify-content: center;
        transition: all .13s; margin-top: 1px;
      }
      .rv-tog-on { background: var(--accent-wash); color: var(--accent); }
      .rv-tog-off { background: var(--paper-sunken); color: var(--ink-faint); }
      .rv-tog-on:hover { background: var(--accent); color: #fff; }
      .rv-tog-off:hover { background: var(--line); color: var(--ink); }

      .rv-sec-content { flex: 1; min-width: 0; }
      .rv-sec-title {
        display: flex; align-items: center; gap: 8px;
        font-weight: 600; font-size: 14px; padding-top: 6px;
      }
      .rv-sec-count {
        font-size: 11px; font-weight: 500; padding: 1px 7px;
        background: var(--paper-sunken); color: var(--ink-faint); border-radius: 10px;
      }

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
