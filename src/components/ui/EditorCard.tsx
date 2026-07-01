import { ReactNode } from 'react'
import { useStore } from '../../store/useStore'
import { useReorderGuard } from '../../store/useReorderGuard'
import {
  ChevronDown, Star, Eye, EyeOff, ArrowUp, ArrowDown, Trash2, GripVertical,
} from 'lucide-react'
import type { SectionKey } from '../../types'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type ArraySection = SectionKey

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
  const secondaryLocale = useStore((s) => s.secondaryLocale)
  const guard = useReorderGuard(section)
  const open = expandedItemId === id
  // Only widen the card when editing in two languages — a single-language
  // editor doesn't need the extra width (see the .ec-wide rule).
  const wide = open && !!secondaryLocale

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
      className={`ec ${open ? 'open' : ''} ${wide ? 'ec-wide' : ''} ${disabled ? 'is-disabled' : ''} ${isDragging ? 'is-dragging' : ''}`}
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
        <span className="ec-chev" aria-hidden="true"><ChevronDown size={17} /></span>
        {/* The title block is the keyboard/AT toggle: a real button carrying
            aria-expanded. The head div's onClick stays as a pointer-only
            convenience for the padding around it. */}
        <button
          type="button"
          className="ec-titles"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); setExpandedItem(id) }}
        >
          <span className="ec-title">
            {starred && <Star size={13} className="ec-star-ind" fill="currentColor" aria-hidden="true" />}
            {title || <span className="ec-untitled">Untitled</span>}
          </span>
          {subtitle && <span className="ec-subtitle">{subtitle}</span>}
        </button>
        {meta && <div className="ec-meta">{meta}</div>}
        <div className="ec-actions" onClick={(e) => e.stopPropagation()}>
          {canStar && (
            <button className={`ec-act ${starred ? 'on' : ''}`} title="Feature"
              aria-label="Feature" aria-pressed={!!starred}
              onClick={() => updateItem(section, id, { starred: !starred } as never)}>
              <Star size={15} fill={starred ? 'currentColor' : 'none'} />
            </button>
          )}
          {canDisable && (
            <button className={`ec-act ${disabled ? 'on-off' : ''}`} title={disabled ? 'Hidden from exports' : 'Visible'}
              aria-label="Hide from exports" aria-pressed={!!disabled}
              onClick={() => updateItem(section, id, { disabled: !disabled } as never)}>
              {disabled ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          {sortable && (
            <>
              <button className="ec-act" title="Move up" aria-label="Move up" onClick={() => guard(() => reorderItem(section, id, 'up'))}><ArrowUp size={15} /></button>
              <button className="ec-act" title="Move down" aria-label="Move down" onClick={() => guard(() => reorderItem(section, id, 'down'))}><ArrowDown size={15} /></button>
            </>
          )}
          <button className="ec-act ec-del" title="Delete" aria-label="Delete"
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
        .ec.open { box-shadow: var(--shadow-md); border-color: var(--line-strong); overflow: visible; }
        /* When editing in two languages, the card itself breaks out wider than
           the ~930px content column (up to the viewport) so each language column
           of the main description gets a comfortable width — WITHOUT any field
           overflowing the card. max(100%, …) never shrinks it below the normal
           column width (narrow viewports / the sidebar drawer stay normal); the
           cap keeps ultra-wide screens sane. overflow:visible (above) lets the
           chip translation popovers escape; nothing else exceeds the card. */
        .ec.ec-wide { width: min(1240px, max(100%, calc(100vw - 350px))); }
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
        .ec-titles {
          flex: 1; min-width: 0; text-align: left; padding: 0; cursor: pointer;
        }
        .ec-title {
          font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 7px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ec-star-ind { color: var(--gold); flex-shrink: 0; }
        .ec-untitled { color: var(--ink-faint); font-weight: 400; font-style: italic; }
        .ec-subtitle { display: block; font-size: 12.5px; color: var(--ink-faint); margin-top: 1px; }
        .ec-meta { font-size: 12px; color: var(--ink-faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .ec-actions { display: flex; gap: 1px; }
        .ec-act {
          width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--r-sm);
          color: var(--ink-faint); transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
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
          width: 100%; padding: 13px; margin-bottom: 10px;
          border: 1.5px dashed var(--line-strong);
          border-radius: var(--r-md); color: var(--ink-soft); font-weight: 600; font-size: 14px;
          transition: color .15s, background .15s, border-color .15s, box-shadow .15s; background: transparent;
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
