/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CoursesEditor } from '../../src/components/editor/SimpleEditors'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { makeResume } from '../fixtures'

function seedEmptyResume() {
  useStore.setState({
    data: {
      resume: makeResume({ supported_locales: ['en'] }),
      skills: [], roles: [], key_qualifications: [], key_competencies: [],
      recommendations: [], projects: [],
      work_experiences: [], educations: [], courses: [], certifications: [],
      spoken_languages: [], positions: [],
      presentations: [], honor_awards: [], publications: [], references: [],
      views: [], skill_categories: [],
    },
    hasData: true,
    primaryLocale: 'en',
    secondaryLocale: null,
    activeSection: 'courses',
    expandedItemId: null,
  })
}

describe('<CoursesEditor>', () => {
  beforeEach(() => resetStore())

  it('adds a course to the store and auto-expands it', async () => {
    seedEmptyResume()
    render(<CoursesEditor />)
    expect(useStore.getState().data.courses).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: /Add course/i }))

    const courses = useStore.getState().data.courses
    expect(courses).toHaveLength(1)
    expect(useStore.getState().expandedItemId).toBe(courses[0].id)
  })

  it('updates the course name through the DualField', async () => {
    seedEmptyResume()
    render(<CoursesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /Add course/i }))

    // After the card is open the "Course name" DualField is the first textbox.
    const nameInput = screen.getAllByRole('textbox')[0]
    await userEvent.type(nameInput, 'Kubernetes')

    const courses = useStore.getState().data.courses
    expect(courses[0].name.en).toBe('Kubernetes')
  })

  it('bumps mutationCount on add', async () => {
    seedEmptyResume()
    const before = useStore.getState().mutationCount
    render(<CoursesEditor />)
    await userEvent.click(screen.getByRole('button', { name: /Add course/i }))
    expect(useStore.getState().mutationCount).toBe(before + 1)
  })
})
