/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SortableList } from '../../src/components/ui/SortableList'
import { EditorCard } from '../../src/components/ui/EditorCard'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeCourse } from '../fixtures'

function seedCourses() {
  const a = makeCourse({ id: 'a', name: { en: 'Alpha' } })
  const b = makeCourse({ id: 'b', name: { en: 'Beta' } })
  useStore.setState({
    data: { ...emptyStore(), courses: [a, b] },
    hasData: true, primaryLocale: 'en', secondaryLocale: null,
    activeSection: 'courses', expandedItemId: null, mutationCount: 0,
  })
  return [a, b]
}

describe('<SortableList>', () => {
  beforeEach(() => resetStore())

  it('mounts the dnd context and renders its children in order', () => {
    seedCourses()
    render(
      <SortableList section="courses" ids={['a', 'b']}>
        <EditorCard section="courses" id="a" title="Alpha"><div /></EditorCard>
        <EditorCard section="courses" id="b" title="Beta"><div /></EditorCard>
      </SortableList>,
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('wires a drag handle onto each sortable card', () => {
    seedCourses()
    render(
      <SortableList section="courses" ids={['a', 'b']}>
        <EditorCard section="courses" id="a" title="Alpha"><div /></EditorCard>
        <EditorCard section="courses" id="b" title="Beta"><div /></EditorCard>
      </SortableList>,
    )
    expect(screen.getAllByLabelText('Drag handle')).toHaveLength(2)
  })

  it('reorders through the store moveItem (keyboard-arrow equivalent)', () => {
    seedCourses()
    // The drag interaction itself is exercised by dnd-kit; here we assert the
    // store action SortableList delegates to produces the expected order.
    useStore.getState().moveItem('courses', 'b', 0)
    expect(useStore.getState().data.courses.map((c) => c.id)).toEqual(['b', 'a'])
  })
})
