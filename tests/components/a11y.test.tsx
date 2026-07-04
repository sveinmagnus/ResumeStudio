/**
 * @vitest-environment jsdom
 *
 * Accessibility regression net (roadmap A8.4). Runs axe-core over the major
 * editor surfaces so a missing button name / unlabelled control / bad ARIA
 * can't slip back in. jsdom has no layout, so axe's colour-contrast rule is
 * inert here (contrast is held by the AA-verified design tokens in index.css
 * + the cyan --secondary-ink-text convention); everything else runs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { ProjectsEditor } from '../../src/components/editor/ProjectsEditor'
import { SkillsEditor, RolesEditor, IndustriesEditor, ReferencesEditor } from '../../src/components/editor/RegistryEditors'
import { WorkEditor, PublicationsEditor } from '../../src/components/editor/SimpleEditors'
import { HeaderEditor } from '../../src/components/editor/HeaderEditor'
import { Overview } from '../../src/components/editor/Overview'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import {
  emptyStore, makeResume, makeProject, makeSkill, makeRole, makeIndustry, makeReference,
  makeCertification, makeWork, makePublication, makeSkillCategory,
} from '../fixtures'
import type { ResumeStore } from '../../src/types'

expect.extend(toHaveNoViolations)

function seed(over: Partial<ResumeStore> = {}, extra: Record<string, unknown> = {}) {
  useStore.setState({
    data: { ...emptyStore(), resume: makeResume({ supported_locales: ['en', 'no'] }), ...over },
    hasData: true, primaryLocale: 'en', secondaryLocale: 'no',
    activeSection: 'projects', expandedItemId: null, mutationCount: 0,
    ...extra,
  })
}

beforeEach(() => resetStore())
afterEach(() => vi.restoreAllMocks())

describe('accessibility (axe) — editor surfaces', () => {
  it('ProjectsEditor (with an expanded card) has no violations', async () => {
    const project = makeProject({ id: 'p1', customer: { en: 'Acme' } })
    seed({ projects: [project] }, { activeSection: 'projects', expandedItemId: 'p1' })
    const { container } = render(<ProjectsEditor />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('SkillsEditor has no violations', async () => {
    seed(
      { skills: [makeSkill({ id: 's1', name: { en: 'TypeScript' } })] },
      { activeSection: 'skills', expandedItemId: 's1' },
    )
    const { container } = render(<SkillsEditor />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('RolesEditor has no violations', async () => {
    seed(
      { roles: [makeRole({ id: 'r1', name: { en: 'Architect' } })] },
      { activeSection: 'roles', expandedItemId: 'r1' },
    )
    const { container } = render(<RolesEditor />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('IndustriesEditor (with two entries → merge UI) has no violations', async () => {
    seed(
      {
        industries: [
          makeIndustry({ id: 'i1', name: { en: 'Finance' } }),
          makeIndustry({ id: 'i2', name: { en: 'Energy' } }),
        ],
      },
      { activeSection: 'industries', expandedItemId: 'i1' },
    )
    const { container } = render(<IndustriesEditor />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('ReferencesEditor has no violations', async () => {
    seed(
      { references: [makeReference({ id: 'ref1', name: 'Kari' })] },
      { activeSection: 'references', expandedItemId: 'ref1' },
    )
    const { container } = render(<ReferencesEditor />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('WorkEditor (employment-type select) has no violations', async () => {
    seed(
      { work_experiences: [makeWork({ id: 'w1', employer: { en: 'Cartavio' } })] },
      { activeSection: 'work_experiences', expandedItemId: 'w1' },
    )
    const { container } = render(<WorkEditor />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('PublicationsEditor (type select) has no violations', async () => {
    seed(
      { publications: [makePublication({ id: 'pub1', title: { en: 'Paper' } })] },
      { activeSection: 'publications', expandedItemId: 'pub1' },
    )
    const { container } = render(<PublicationsEditor />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('SkillsEditor — By-category view (the Skills Showcase surface) has no violations', async () => {
    seed(
      {
        skill_categories: [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })],
        skills: [makeSkill({ id: 's1', name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: true })],
      },
      { activeSection: 'skills' },
    )
    const { container } = render(<SkillsEditor />)
    await userEvent.click(screen.getByRole('button', { name: /by category/i }))
    expect(await axe(container)).toHaveNoViolations()
  })

  it('HeaderEditor (Personal Details) has no violations', async () => {
    seed({}, { activeSection: 'header' })
    const { container } = render(<HeaderEditor />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('Overview with a "needs attention" panel has no violations', async () => {
    seed({
      projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, end: null })],
      work_experiences: [makeWork({ id: 'w1' })],
      certifications: [makeCertification({
        id: 'c1', name: { en: 'Expired cert' },
        expires: { year: 2020, month: 1 },
      })],
    }, { activeSection: 'overview' })
    const { container } = render(<Overview />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
