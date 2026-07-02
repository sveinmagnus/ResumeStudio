/**
 * Registry "by category" view — grouped, compact, drag-to-recategorize.
 *
 * Shared by the Skill and Role registries (see RegistryEditors.tsx): any item
 * with a free-text `category` groups under category headers; drag a chip onto
 * another header to recategorize it, click a chip to open its editor in a
 * lightbox. Purely presentational — all mutations happen through the callbacks
 * the parent editor passes in.
 */
import { useMemo, type ReactNode } from 'react'
import { useStore } from '../../store/useStore'
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core'
import { useDialog } from '../ui/useDialog'
import { X } from 'lucide-react'
import { resolve } from '../../lib/locales'
import type { LocalizedString } from '../../types'

const UNCATEGORIZED = '__uncategorized__'

export interface CatItem {
  id: string
  name: LocalizedString
  category?: string | null
  /** Whether this item carries an explicit category that the "x" can remove. */
  removable?: boolean
}

/** Distinct, sorted category labels (non-empty) across items. */
export function categoriesOf(items: CatItem[]): string[] {
  const set = new Set<string>()
  for (const it of items) {
    const c = (it.category ?? '').trim()
    if (c) set.add(c)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

export function RegistryCategoryView({ items, unnamed, onOpen, onRecategorize, onRemove }: {
  items: CatItem[]
  /** Label for an item with no name yet, e.g. "(unnamed skill)". */
  unnamed: string
  onOpen: (id: string) => void
  onRecategorize: (id: string, category: string | null) => void
  /** Optional: clear an item's explicit category (renders an "x" on removable chips). */
  onRemove?: (id: string) => void
}) {
  const locale = useStore((s) => s.primaryLocale)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // Group by category (Uncategorized last), categories A→Z.
  const groups = useMemo(() => {
    const m = new Map<string, CatItem[]>()
    for (const it of items) {
      const key = (it.category ?? '').trim() || UNCATEGORIZED
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(it)
    }
    return [...m.entries()].sort(([a], [b]) => {
      if (a === UNCATEGORIZED) return 1
      if (b === UNCATEGORIZED) return -1
      return a.localeCompare(b)
    })
  }, [items])

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over) return
    const target = String(over.id) === UNCATEGORIZED ? null : String(over.id)
    const it = items.find((x) => x.id === String(active.id))
    if (!it || (it.category ?? null) === target) return
    onRecategorize(String(active.id), target)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="rcv">
        {groups.map(([key, list]) => (
          <CatGroup key={key} catKey={key} label={key === UNCATEGORIZED ? 'Uncategorized' : key}
            items={list} locale={locale} unnamed={unnamed} onOpen={onOpen} onRemove={onRemove} />
        ))}
      </div>
    </DndContext>
  )
}

function CatGroup({ catKey, label, items, locale, unnamed, onOpen, onRemove }: {
  catKey: string; label: string; items: CatItem[]; locale: string; unnamed: string
  onOpen: (id: string) => void; onRemove?: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: catKey })
  return (
    <div className="rcv-group">
      <div ref={setNodeRef} className={`rcv-head ${isOver ? 'is-over' : ''}`}>
        {label} <span className="rcv-count">{items.length}</span>
      </div>
      <div className="rcv-chips">
        {items.map((it) => (
          <CatChip key={it.id} item={it} locale={locale} unnamed={unnamed} onOpen={onOpen} onRemove={onRemove} />
        ))}
      </div>
    </div>
  )
}

function CatChip({ item, locale, unnamed, onOpen, onRemove }: {
  item: CatItem; locale: string; unnamed: string
  onOpen: (id: string) => void; onRemove?: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id })
  // Transform (drag movement) applies to the wrapper so the chip + its "x" move
  // together; the draggable ref/listeners stay on the label button.
  const style = transform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
    : undefined
  const label = resolve(item.name, locale) || unnamed
  const showRemove = !!(onRemove && item.removable)
  return (
    <span className={`rcv-chip-wrap ${isDragging ? 'is-dragging' : ''}`} style={style}>
      <button
        ref={setNodeRef}
        type="button"
        className={`rcv-chip ${showRemove ? 'has-x' : ''}`}
        {...attributes}
        {...listeners}
        onClick={() => onOpen(item.id)}
        title="Drag to another category · click to edit"
      >
        {label}
      </button>
      {showRemove && (
        <button
          type="button"
          className="rcv-chip-x"
          onClick={(e) => { e.stopPropagation(); onRemove!(item.id) }}
          aria-label={`Remove category from ${label}`}
          title="Remove category"
        >
          <X size={12} />
        </button>
      )}
    </span>
  )
}

/** Lightbox chrome for the category-view editor (content passed as children). */
export function RegistryLightbox({ title, ariaLabel, onClose, children }: {
  title: string; ariaLabel: string; onClose: () => void; children: ReactNode
}) {
  const dialogRef = useDialog(onClose)
  return (
    <div className="rcv-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="rcv-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={ariaLabel} onClick={(e) => e.stopPropagation()}>
        <div className="rcv-modal-head">
          <h3>{title}</h3>
          <button className="rcv-modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
      <style>{`
        .rcv-modal-backdrop {
          position: fixed; inset: 0; background: rgba(15,23,42,.45);
          display: grid; place-items: center; z-index: 100; padding: 24px; animation: fadeIn .15s ease;
        }
        .rcv-modal {
          background: var(--paper); border-radius: var(--r-lg); box-shadow: var(--shadow-lg);
          width: min(640px, 94vw); max-height: 88vh; overflow-y: auto; overscroll-behavior: contain;
          padding: 20px 24px 24px; animation: fadeUp .2s ease;
        }
        .rcv-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .rcv-modal-head h3 { font-size: 20px; }
        .rcv-modal-close { width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--r-sm); color: var(--ink-faint); }
        .rcv-modal-close:hover { background: var(--paper-sunken); color: var(--accent); }
      `}</style>
    </div>
  )
}
