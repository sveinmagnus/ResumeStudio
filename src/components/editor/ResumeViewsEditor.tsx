import { useState } from 'react'
import { useStore, newId } from '../../store/useStore'
import { buildViewSections } from '../../lib/viewFilter'
import { DEFAULT_VIEW_STYLE } from '../../lib/viewStyle'
import { DEFAULT_VIEW_HEADER, DEFAULT_VIEW_FOOTER, defaultHeaderFields } from '../../lib/viewHeader'
import type { TailorResult } from '../../lib/viewTailor'
import type { ResumeView } from '../../types'
import { Plus, Pencil, Trash2, LayoutList, Wand2 } from 'lucide-react'
import { ViewEditor } from './views/ViewEditor'
import { TailorViewModal } from './views/TailorViewModal'
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

function ViewList({ views, onCreate, onTailor, onEdit, onDelete }: {
  views: ResumeView[]
  onCreate: () => void
  onTailor: () => void
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
