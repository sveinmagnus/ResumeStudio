import { ReactNode } from 'react'
import { useStore } from '../../store/useStore'
import { useReorderGuard } from '../../store/useReorderGuard'
import {
  ChevronDown, Star, Eye, EyeOff, ArrowUp, ArrowDown, Trash2, GripVertical,
} from 'lucide-react'
import type { ResumeStore } from '../../types'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type ArraySection = Exclude<keyof ResumeStore, 'resume'>

interface EditorCardProps {
  section: ArraySection
  id: string
  title: string
  subtitle?: string
  meta?: string
  /**
   * Full descriptive text shown in the COLLAPSED list view, below the title
   * row. Multi-line, no truncation — the point is to let the user scan the
   * full content while looking over the list. Hidden when the card is open
   * (the same text is being edited inline below).
   */
  preview?: string
  starred?: boolean
  disabled?: boolean
  canStar?: boolean
  canDisable?: boolean
  /**
   * Whether to render the drag handle and wire up dnd-kit's sortable for
   * this card. Default true. Pass `false` from editors that intentionally
   * don't reorder (e.g. alphabetically-sorted Skills, References without a
   * sort_order field) so the grip doesn't lie about being draggable.
   */
  sortable?: boolean
  children: ReactNode
}

export function EditorCard({
  section, id, title, subtitle, meta, preview, starred, disabled,
  canStar = true, canDisable = true, sortable = true, children,
}: EditorCardProps) {
  const { expandedItemId, setExpandedItem, updateItem, removeItem, reorderItem } = useStore()
  const guard = useReorderGuard(section)
  const open = expandedItemId === id

  // useSortable is called unconditionally because hooks may not be
  // conditional. When `sortable` is false we still pay the (tiny) hook
  // cost, but we don't render the grip and we ignore the transform so the
  // card looks identical to its old static self.
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = sortable
    ? { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
    : {}

  return (
    <div
      ref={sortable ? setNodeRef : undefined}
      style={style}
      data-card-id={id}
      className={`ec ${open ? 'open' : ''} ${disabled ? 'is-disabled' : ''} ${isDragging ? 'is-dragging' : ''}`}
    >
      <div className="ec-head" onClick={() => setExpandedItem(id)}>
        {sortable && (
          <button
            className="ec-grip"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder"
            aria-label="Drag handle"
          >
            <GripVertical size={15} />
          </button>
        )}
        <button className="ec-chev"><ChevronDown size={17} /></button>
        <div className="ec-titles">
          <div className="ec-title">
            {starred && <Star size={13} className="ec-star-ind" fill="currentColor" />}
            {title || <span className="ec-untitled">Untitled</span>}
          </div>
          {subtitle && <div className="ec-subtitle">{subtitle}</div>}
        </div>
        {meta && <div className="ec-meta">{meta}</div>}
        <div className="ec-actions" onClick={(e) => e.stopPropagation()}>
          {canStar && (
            <button className={`ec-act ${starred ? 'on' : ''}`} title="Feature"
              onClick={() => updateItem(section, id, { starred: !starred } as never)}>
              <Star size={15} fill={starred ? 'currentColor' : 'none'} />
            </button>
          )}
          {canDisable && (
            <button className={`ec-act ${disabled ? 'on-off' : ''}`} title={disabled ? 'Hidden from exports' : 'Visible'}
              onClick={() => updateItem(section, id, { disabled: !disabled } as never)}>
              {disabled ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          {sortable && (
            <>
              <button className="ec-act" title="Move up" onClick={() => guard(() => reorderItem(section, id, 'up'))}><ArrowUp size={15} /></button>
              <button className="ec-act" title="Move down" onClick={() => guard(() => reorderItem(section, id, 'down'))}><ArrowDown size={15} /></button>
            </>
          )}
          <button className="ec-act ec-del" title="Delete"
            onClick={() => { if (confirm('Delete this item?')) removeItem(section, id) }}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {!open && preview && (
        <div className="ec-preview" onClick={() => setExpandedItem(id)}>{preview}</div>
      )}
      {open && <div className="ec-body">{children}</div>}

      <style>{`
        .ec {
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-md); margin-bottom: 10px; overflow: hidden;
          transition: box-shadow .2s, border-color .2s;
        }
        .ec.open { box-shadow: var(--shadow-md); border-color: var(--line-strong); }
        .ec.is-disabled { opacity: .55; }
        .ec.is-dragging { box-shadow: var(--shadow-lg); border-color: var(--accent); z-index: 5; position: relative; }
        .ec-head {
          display: flex; align-items: center; gap: 8px; padding: 13px 15px; cursor: pointer;
        }
        .ec-head:hover { background: var(--paper-sunken); }
        .ec-grip {
          color: var(--ink-faint); cursor: grab; padding: 4px 2px;
          display: grid; place-items: center; touch-action: none;
        }
        .ec-grip:active { cursor: grabbing; }
        .ec-grip:hover { color: var(--accent); }
        .ec-chev { color: var(--ink-faint); transition: transform .2s; display: grid; place-items: center; }
        .ec.open .ec-chev { transform: rotate(180deg); }
        .ec-titles { flex: 1; min-width: 0; }
        .ec-title {
          font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 7px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ec-star-ind { color: var(--gold); flex-shrink: 0; }
        .ec-untitled { color: var(--ink-faint); font-weight: 400; font-style: italic; }
        .ec-subtitle { font-size: 12.5px; color: var(--ink-faint); margin-top: 1px; }
        .ec-meta { font-size: 12px; color: var(--ink-faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .ec-actions { display: flex; gap: 1px; }
        .ec-act {
          width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--r-sm);
          color: var(--ink-faint); transition: all .13s;
        }
        .ec-act:hover { background: var(--paper); color: var(--ink); }
        .ec-act.on { color: var(--gold); }
        .ec-act.on-off { color: var(--accent); }
        .ec-del:hover { background: var(--accent-wash); color: var(--accent); }
        .ec-preview {
          padding: 0 18px 14px;
          font-size: 13px;
          line-height: 1.55;
          color: var(--ink-soft);
          white-space: pre-wrap;
          cursor: pointer;
        }
        .ec-body {
          padding: 6px 18px 20px; border-top: 1px solid var(--line);
          animation: fadeIn .25s ease;
        }
      `}</style>
    </div>
  )
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="add-btn" onClick={onClick}>
      + {label}
      <style>{`
        .add-btn {
          width: 100%; padding: 13px; border: 1.5px dashed var(--line-strong);
          border-radius: var(--r-md); color: var(--ink-soft); font-weight: 600; font-size: 14px;
          transition: all .15s; background: transparent;
        }
        .add-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
      `}</style>
    </button>
  )
}

export function FieldRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
      {children}
    </div>
  )
}
