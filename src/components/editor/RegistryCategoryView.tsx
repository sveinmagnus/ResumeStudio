/**
 * Registry "by category" view — grouped, compact, drag-to-recategorize.
 *
 * Shared by the Skill and Role registries (see RegistryEditors.tsx): any item
 * with a free-text `category` groups under category headers; drag a chip onto
 * another header to recategorize it, click a chip to open its editor in a
 * lightbox. Purely presentational — all mutations happen through the callbacks
 * the parent editor passes in.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../store/useStore'
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  pointerWithin, MeasuringStrategy, type DragEndEvent,
} from '@dnd-kit/core'
import { useDialog } from '../ui/useDialog'
import { X } from 'lucide-react'
import { resolve } from '../../lib/locales'
import type { LocalizedString } from '../../types'

const UNCATEGORIZED = '__uncategorized__'
/** Droppable-id prefix for the floating quick-select panel (kept distinct from
 *  the header droppables, which share the plain category key). */
const PANEL = 'panel:'

export interface CatItem {
  id: string
  name: LocalizedString
  category?: string | null
  /** Whether this item carries an explicit category that the "x" can remove. */
  removable?: boolean
}

/**
 * Resolve a dnd-kit droppable id to the category to assign. Drops land on either
 * a category header (plain key) or a floating quick-panel row (PANEL-prefixed);
 * the Uncategorized sentinel maps to `null` (clear the category). PURE.
 */
export function dropTargetCategory(overId: string): string | null {
  const key = overId.startsWith(PANEL) ? overId.slice(PANEL.length) : overId
  return key === UNCATEGORIZED ? null : key
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

export function RegistryCategoryView({ items, unnamed, onOpen, onRecategorize, onRemove, onClearCategory }: {
  items: CatItem[]
  /** Label for an item with no name yet, e.g. "(unnamed skill)". */
  unnamed: string
  onOpen: (id: string) => void
  onRecategorize: (id: string, category: string | null) => void
  /** Optional: clear an item's explicit category (renders an "x" on removable chips). */
  onRemove?: (id: string) => void
  /** Optional: clear the category off every item in a group (renders an "x" in the header). */
  onClearCategory?: (ids: string[]) => void
}) {
  const locale = useStore((s) => s.primaryLocale)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [dragging, setDragging] = useState(false)

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
    setDragging(false)
    const { active, over } = e
    if (!over) return
    const target = dropTargetCategory(String(over.id))
    const it = items.find((x) => x.id === String(active.id))
    if (!it || (it.category ?? null) === target) return
    onRecategorize(String(active.id), target)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      // The quick-select panel's droppables mount only after the drag starts, so
      // measure droppables continuously — otherwise dnd-kit never learns their
      // rects and dropping on a panel row is a no-op.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(false)}
    >
      <div className="rcv">
        {groups.map(([key, list]) => (
          <CatGroup key={key} catKey={key} label={key === UNCATEGORIZED ? 'Uncategorized' : key}
            items={list} locale={locale} unnamed={unnamed} onOpen={onOpen} onRemove={onRemove}
            onClearCategory={onClearCategory} />
        ))}
      </div>
      {dragging && groups.length > 1 && (
        <CategoryDropPanel groups={groups} />
      )}
    </DndContext>
  )
}

/**
 * Floating quick-select drop target: appears on the right while a chip is being
 * dragged so the destination category is always one short move away, no matter
 * how long the list is. Each row mirrors a category header as its own droppable
 * (PANEL-prefixed id so it doesn't collide with the header's).
 */
function CategoryDropPanel({ groups }: { groups: [string, CatItem[]][] }) {
  return (
    <div className="rcv-drop-panel" role="presentation">
      <div className="rcv-drop-title">Drop on a category</div>
      <div className="rcv-drop-list">
        {groups.map(([key, list]) => (
          <DropRow key={key} catKey={key}
            label={key === UNCATEGORIZED ? 'Uncategorized' : key} count={list.length} />
        ))}
      </div>
    </div>
  )
}

function DropRow({ catKey, label, count }: { catKey: string; label: string; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: PANEL + catKey })
  return (
    <div ref={setNodeRef} className={`rcv-drop-row ${isOver ? 'is-over' : ''}`}>
      <span className="rcv-drop-label">{label}</span>
      <span className="rcv-count">{count}</span>
    </div>
  )
}

function CatGroup({ catKey, label, items, locale, unnamed, onOpen, onRemove, onClearCategory }: {
  catKey: string; label: string; items: CatItem[]; locale: string; unnamed: string
  onOpen: (id: string) => void; onRemove?: (id: string) => void
  onClearCategory?: (ids: string[]) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: catKey })
  const canClear = !!onClearCategory && catKey !== UNCATEGORIZED
  return (
    <div className="rcv-group">
      <div ref={setNodeRef} className={`rcv-head ${isOver ? 'is-over' : ''}`}>
        <span className="rcv-head-label">{label} <span className="rcv-count">{items.length}</span></span>
        {canClear && (
          <button
            type="button"
            className="rcv-head-x"
            onClick={() => onClearCategory!(items.map((i) => i.id))}
            aria-label={`Clear category "${label}" from all ${items.length} item(s)`}
            title="Remove this category from all its items (they become Uncategorized)"
          >
            <X size={14} />
          </button>
        )}
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
