import { useEffect, useState, type MouseEvent } from 'react'
import { useStore, newId } from '../../store/useStore'
import { buildViewSections } from '../../lib/viewFilter'
import { DEFAULT_VIEW_STYLE } from '../../lib/viewStyle'
import { DEFAULT_VIEW_HEADER, DEFAULT_VIEW_FOOTER, defaultHeaderFields } from '../../lib/viewHeader'
import { getDefaultFonts, onDefaultFontsChanged } from '../../lib/appPrefs'
import { Link, isPlainLeftClick } from '../../lib/router'
import type { TailorResult } from '../../lib/viewTailor'
import type { ResumeStore, ResumeView } from '../../types'
import type { GlobalFonts } from '../../lib/fonts'
import { Plus, Pencil, Trash2, LayoutList, Wand2 } from 'lucide-react'
import { ViewEditor } from './views/ViewEditor'
import { TailorViewModal } from './views/TailorViewModal'
import { ExportMenu } from './views/ExportMenu'
import { useViewExport, useExportAllViews, viewExportLocale } from './views/useViewExport'
import { Styles } from './views/Styles'

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
      export_locale: null,
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

  const [showTailor, setShowTailor] = useState(false)
  const applyTailored = (result: TailorResult) => {
    addItem('views', result.view)
    setShowTailor(false)
    setActiveView(result.view.id)
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

  return (
    <>
      <ViewList
        views={views}
        onCreate={createView}
        onTailor={() => setShowTailor(true)}
        onEdit={setActiveView}
        onDelete={deleteView}
      />
      {showTailor && <TailorViewModal onApply={applyTailored} onClose={() => setShowTailor(false)} />}
    </>
  )
}

// ─── View list ────────────────────────────────────────────────────────────────

/**
 * One view's export dropdown on the list, so a routine re-export (same view,
 * same format, newer content) never requires opening the editor. Exports in
 * the view's own persisted language (viewExportLocale) — the list has no
 * language selector, and a Board CV exporting in the wrong language because it
 * was exported from the list would be a trap.
 */
function RowExport({ data, view, globalFonts, onExported }: {
  data: ResumeStore
  view: ResumeView
  globalFonts: GlobalFonts
  onExported: () => void
}) {
  const primaryLocale = useStore((s) => s.primaryLocale)
  const {
    pdfBusy, docxBusy, htmlBusy, error, clearError,
    exportPdf, exportDocx, exportHtml, exportTextual,
  } = useViewExport(data, view, viewExportLocale(data, view, primaryLocale), globalFonts, onExported)

  return (
    <>
      <ExportMenu
        label="Export"
        onPdf={exportPdf}
        onDocx={exportDocx}
        onHtml={exportHtml}
        onText={() => exportTextual('txt')}
        onMarkdown={() => exportTextual('md')}
        onEuropass={() => exportTextual('xml')}
        onJsonResume={() => exportTextual('jsonresume')}
        pdfBusy={pdfBusy}
        docxBusy={docxBusy}
        htmlBusy={htmlBusy}
        lastExportedAt={view.last_exported_at}
      />
      {error && (
        <div className="rv-export-err" role="alert">
          {error}
          <button type="button" className="rv-export-err-x" onClick={clearError} aria-label="Dismiss">✕</button>
        </div>
      )}
    </>
  )
}

function ViewList({ views, onCreate, onTailor, onEdit, onDelete }: {
  views: ResumeView[]
  onCreate: () => void
  onTailor: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const data = useStore((s) => s.data)
  const currentResumeId = useStore((s) => s.currentResumeId)
  const updateItem = useStore((s) => s.updateItem)
  const primaryLocale = useStore((s) => s.primaryLocale)

  // App-wide default fonts an 'inherit' view exports with; track live so a
  // Settings change mid-session reaches an export clicked from this page.
  const [globalFonts, setGlobalFonts] = useState(getDefaultFonts)
  useEffect(() => onDefaultFontsChanged(() => setGlobalFonts(getDefaultFonts())), [])

  const stampExported = (viewId: string) =>
    updateItem('views', viewId, { last_exported_at: new Date().toISOString() })

  const exportAll = useExportAllViews(data, views, primaryLocale, globalFonts, stampExported)

  /**
   * The card body is a real link (Ctrl/middle-click opens the view in its own
   * tab — comparing two views side by side is a genuine need), but a PLAIN
   * click routes through onEdit instead: setActiveView writes the URL with the
   * resume's readable address in one step, where following the href would push
   * the id spelling first and rewrite after.
   */
  const openOnPlainClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!isPlainLeftClick(e)) return
    e.preventDefault()
    onEdit(id)
  }

  return (
    <div className="rv-pane">
      <div className="rv-list-intro">
        <p>
          A Resume View is a curated subset of your master CV — choose which sections
          and items appear, write a custom introduction, then export as a targeted document.
          Use views to produce a Board CV, a Consultant project CV, an Employment history,
          or any other variant from the same data.
        </p>
        <div className="rv-create-row">
          <button className="rv-create-btn" onClick={onCreate}>
            <Plus size={15} /> New View
          </button>
          <button className="rv-create-btn rv-tailor-btn" onClick={onTailor} title="Paste a job posting, run a prompt in your own LLM, get a tailored view proposal">
            <Wand2 size={15} /> Tailor from job posting
          </button>
        </div>
      </div>

      {views.length === 0 ? (
        <div className="rv-empty">
          <LayoutList size={36} />
          <p>No views yet.</p>
          <p className="rv-empty-sub">Create your first view to extract a targeted resume.</p>
        </div>
      ) : (
        <>
          <div className="rv-list-toolbar">
            <ExportMenu
              label={exportAll.progress ?? 'Export all'}
              onPdf={() => exportAll.run('pdf')}
              onDocx={() => exportAll.run('docx')}
              onHtml={() => exportAll.run('html')}
              onText={() => exportAll.run('txt')}
              onMarkdown={() => exportAll.run('md')}
              onEuropass={() => exportAll.run('xml')}
              onJsonResume={() => exportAll.run('jsonresume')}
              pdfBusy={exportAll.busy}
              docxBusy={exportAll.busy}
              htmlBusy={exportAll.busy}
              lastExportedAt={null}
            />
            {exportAll.error && (
              <div className="rv-export-err" role="alert">
                {exportAll.error}
                <button type="button" className="rv-export-err-x" onClick={exportAll.clearError} aria-label="Dismiss">✕</button>
              </div>
            )}
          </div>
          <div className="rv-cards">
            {views.map((v) => {
              const full = v.sections.filter((s) => s.detail === 'full').length
              const summary = v.sections.filter((s) => s.detail === 'summary').length
              const hidden = v.excluded_item_ids.length
              return (
                <div key={v.id} className="rv-card">
                  <Link
                    className="rv-card-main"
                    to={{ name: 'editor', id: currentResumeId ?? '', section: 'views', viewId: v.id }}
                    onClick={(e) => openOnPlainClick(e, v.id)}
                  >
                    <div className="rv-card-icon"><LayoutList size={20} /></div>
                    <div className="rv-card-body">
                      <div className="rv-card-name">{v.name}</div>
                      {/* The purpose note earns its keep HERE — this is where you
                          ask "which of these do I reuse?". Only rendered when set. */}
                      {v.purpose?.trim() && <div className="rv-card-purpose">{v.purpose}</div>}
                      <div className="rv-card-meta">
                        {full} full
                        {summary > 0 ? ` · ${summary} summary` : ''}
                        {hidden > 0 ? ` · ${hidden} item${hidden !== 1 ? 's' : ''} hidden` : ''}
                        {v.starred_only ? ' · starred only' : ''}
                      </div>
                    </div>
                  </Link>
                  <div className="rv-card-actions">
                    <RowExport data={data} view={v} globalFonts={globalFonts} onExported={() => stampExported(v.id)} />
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
        </>
      )}

      <Styles />
    </div>
  )
}
