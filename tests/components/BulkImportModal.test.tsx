/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkImportModal } from '../../src/components/ui/BulkImportModal'
import { SortBar } from '../../src/components/ui/SortBar'
import { bulkSpec, BULK_IMPORT_SCHEMA, type BulkSectionSpec } from '../../src/lib/bulkImport'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume, makeCourse, makeSkill } from '../fixtures'

const coursesSpec = bulkSpec('courses') as BulkSectionSpec
const projectsSpec = bulkSpec('projects') as BulkSectionSpec

function seed(over: Parameters<typeof useStore.setState>[0] = {}) {
  useStore.setState({
    data: { ...emptyStore(), resume: makeResume({ id: 'r1', supported_locales: ['no', 'en'] }) },
    hasData: true,
    primaryLocale: 'no',
    ...over,
  })
}

/** Paste JSON into the textarea and hit Preview. */
async function paste(json: unknown) {
  const user = userEvent.setup()
  const box = screen.getByLabelText('Bulk import JSON')
  // fireEvent-style direct set: the JSON is long and typing it is slow.
  await user.click(box)
  await user.paste(JSON.stringify(json))
  await user.click(screen.getByRole('button', { name: 'Preview items' }))
}

beforeEach(() => {
  resetStore()
  seed()
})

describe('BulkImportModal — instructions', () => {
  it('copies section-specific instructions naming the resume locales', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /Copy instructions/ }))
    const md = writeText.mock.calls[0][0] as string
    expect(md).toContain('bulk add to "Courses"')
    expect(md).toContain('"section": "courses"')
    expect(md).toContain('no (Norsk)')
    expect(md).toContain('en (English)')
  })

  it('tells the user the instructions are tailored to both languages', () => {
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    expect(screen.getByText(/asks for NO \+ EN in one pass/)).toBeInTheDocument()
  })
})

describe('BulkImportModal — validation feedback', () => {
  it('reports invalid JSON without throwing', async () => {
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Bulk import JSON'))
    await user.paste('{not json')
    await user.click(screen.getByRole('button', { name: 'Preview items' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't valid JSON/)
  })

  it('refuses a file meant for another section, naming both', async () => {
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    await paste({ $schema: BULK_IMPORT_SCHEMA, section: 'projects', items: [{ customer: 'X' }] })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('section')
    expect(alert).toHaveTextContent(/this file is for Projects/)
  })

  it('lists field-pathed issues from a malformed file', async () => {
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    await paste({ $schema: BULK_IMPORT_SCHEMA, section: 'courses', items: [{ completed: { year: 12 } }] })
    expect(screen.getByText('items[0].completed.year')).toBeInTheDocument()
  })
})

describe('BulkImportModal — preview and confirm', () => {
  const twoCourses = {
    $schema: BULK_IMPORT_SCHEMA,
    section: 'courses',
    items: [
      { name: { no: 'Kubernetes grunnkurs', en: 'Kubernetes basics' }, program: 'Linux Foundation' },
      { name: 'Rust for Rustaceans', program: 'No Starch' },
    ],
  }

  it('previews each item and adds the ticked ones on confirm', async () => {
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    await paste(twoCourses)

    expect(screen.getByText('2 items found')).toBeInTheDocument()
    // Titles resolve through the primary locale (no).
    expect(screen.getByText('Kubernetes grunnkurs')).toBeInTheDocument()
    expect(screen.getByText('Rust for Rustaceans')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Add 2 to Courses/ }))

    const courses = useStore.getState().data.courses
    expect(courses).toHaveLength(2)
    expect(courses[0].name).toEqual({ no: 'Kubernetes grunnkurs', en: 'Kubernetes basics' })
  })

  it('only adds the items left ticked', async () => {
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    await paste(twoCourses)

    await userEvent.click(screen.getAllByRole('checkbox')[2]) // select-all is [0]
    await userEvent.click(screen.getByRole('button', { name: /Add 1 to Courses/ }))

    const courses = useStore.getState().data.courses
    expect(courses).toHaveLength(1)
    expect(courses[0].name.no).toBe('Kubernetes grunnkurs')
  })

  it('bumps mutationCount so the add is undoable and auto-saves', async () => {
    const before = useStore.getState().mutationCount
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    await paste(twoCourses)
    await userEvent.click(screen.getByRole('button', { name: /Add 2 to Courses/ }))
    expect(useStore.getState().mutationCount).toBeGreaterThan(before)
  })

  it('closes after a successful add', async () => {
    const onClose = vi.fn()
    render(<BulkImportModal spec={coursesSpec} onClose={onClose} />)
    await paste(twoCourses)
    await userEvent.click(screen.getByRole('button', { name: /Add 2 to Courses/ }))
    expect(onClose).toHaveBeenCalled()
  })

  it('unticks a likely duplicate and says so', async () => {
    seed({
      data: {
        ...emptyStore(),
        resume: makeResume({ id: 'r1' }),
        courses: [makeCourse({ name: { no: 'Kubernetes grunnkurs' }, completed: null })],
      },
    })
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    await paste(twoCourses)

    expect(screen.getByText(/looks like|item looks/)).toBeInTheDocument()
    expect(screen.getByText('possible duplicate')).toBeInTheDocument()
    // One of two pre-ticked → the button offers to add only the non-duplicate.
    expect(screen.getByRole('button', { name: /Add 1 to Courses/ })).toBeInTheDocument()
  })

  it('adds a duplicate anyway when the user ticks it back on', async () => {
    seed({
      data: {
        ...emptyStore(),
        resume: makeResume({ id: 'r1' }),
        courses: [makeCourse({ id: 'existing', name: { no: 'Kubernetes grunnkurs' }, completed: null })],
      },
    })
    render(<BulkImportModal spec={coursesSpec} onClose={() => {}} />)
    await paste(twoCourses)

    await userEvent.click(screen.getAllByRole('checkbox')[1]) // tick the flagged one
    await userEvent.click(screen.getByRole('button', { name: /Add 2 to Courses/ }))
    expect(useStore.getState().data.courses).toHaveLength(3)
  })

  it('reports the registry entries a project batch would add, and reuses existing ones', async () => {
    seed({
      data: {
        ...emptyStore(),
        resume: makeResume({ id: 'r1' }),
        skills: [makeSkill({ id: 's-ts', name: { en: 'TypeScript' } })],
      },
    })
    render(<BulkImportModal spec={projectsSpec} onClose={() => {}} />)
    await paste({
      $schema: BULK_IMPORT_SCHEMA,
      section: 'projects',
      items: [{ customer: 'Sparebank 1', skills: ['TypeScript', 'Terraform'], roles: ['Tech lead'] }],
    })

    expect(screen.getByText(/Adds/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Add 1 to Projects/ }))

    const { skills, roles, projects } = useStore.getState().data
    expect(skills).toHaveLength(2)               // TypeScript reused, Terraform new
    expect(roles).toHaveLength(1)
    expect(projects[0].skills[0].skill_id).toBe('s-ts')
  })

  it('does not add a registry entry only a deselected item referenced', async () => {
    render(<BulkImportModal spec={projectsSpec} onClose={() => {}} />)
    await paste({
      $schema: BULK_IMPORT_SCHEMA,
      section: 'projects',
      items: [
        { customer: 'Kept', skills: ['Go'] },
        { customer: 'Dropped', skills: ['Fortran'] },
      ],
    })

    await userEvent.click(screen.getAllByRole('checkbox')[2]) // untick "Dropped"
    await userEvent.click(screen.getByRole('button', { name: /Add 1 to Projects/ }))

    const names = useStore.getState().data.skills.map((s) => s.name.no ?? s.name.en)
    expect(names).toEqual(['Go'])
  })
})

describe('SortBar — the bulk button', () => {
  it('offers bulk add on an empty content section (where sort is hidden)', () => {
    render(<SortBar section="courses" count={0} />)
    expect(screen.getByRole('button', { name: /Bulk add/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument()
  })

  it('shows both halves once the section has items to sort', () => {
    render(<SortBar section="courses" count={3} />)
    expect(screen.getByRole('button', { name: /Bulk add/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Sort')).toBeInTheDocument()
  })

  it('opens the lightbox for the section it sits on', async () => {
    render(<SortBar section="courses" count={0} />)
    await userEvent.click(screen.getByRole('button', { name: /Bulk add/ }))
    expect(screen.getByRole('dialog', { name: 'Bulk add to Courses' })).toBeInTheDocument()
  })

  it('has no bulk button on Languages or the registries', () => {
    const { rerender } = render(<SortBar section="spoken_languages" count={3} />)
    expect(screen.queryByRole('button', { name: /Bulk add/ })).not.toBeInTheDocument()
    rerender(<SortBar section="skills" count={3} />)
    expect(screen.queryByRole('button', { name: /Bulk add/ })).not.toBeInTheDocument()
    rerender(<SortBar section="roles" count={3} />)
    expect(screen.queryByRole('button', { name: /Bulk add/ })).not.toBeInTheDocument()
  })

  it('renders nothing for a section with neither sort nor bulk', () => {
    const { container } = render(<SortBar section="spoken_languages" count={1} />)
    expect(container).toBeEmptyDOMElement()
  })
})
