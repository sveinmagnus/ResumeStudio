/**
 * SortableList — drag-and-drop wrapper for a list of EditorCards.
 *
 * Editors render their EditorCards inside this component. It owns the
 * DndContext + SortableContext boilerplate and turns a successful drop
 * into a `moveItem(section, id, toIndex)` store call. The cards themselves
 * keep their existing accessible up/down arrow buttons; the drag handle is
 * additive UX, not the only way to reorder.
 */
import type { ReactNode } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useStore } from '../../store/useStore'
import { useReorderGuard } from '../../store/useReorderGuard'
import type { ResumeStore } from '../../types'

type ArraySection = Exclude<keyof ResumeStore, 'resume'>

interface Props {
  section: ArraySection
  /** Item ids in the same order as the children, top to bottom. */
  ids: string[]
  children: ReactNode
}

export function SortableList({ section, ids, children }: Props) {
  const moveItem = useStore((s) => s.moveItem)
  const guard = useReorderGuard(section)

  // Pointer sensor: small activation distance so a normal click on the card
  // does not start a drag. Keyboard sensor: Space to lift, arrows to move.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const toIndex = ids.indexOf(String(over.id))
    if (toIndex === -1) return
    // Confirm before discarding a saved custom order when a computed sort
    // mode is active; in custom mode this runs the move immediately.
    guard(() => moveItem(section, String(active.id), toIndex))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}
