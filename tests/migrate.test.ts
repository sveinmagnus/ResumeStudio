import { describe, it, expect } from 'vitest'
import { appendLocalized, buildRoleParagraph, foldRoleDescriptions } from '../src/lib/migrate'
import { emptyStore, makeProject } from './fixtures'
import type { ProjectRole } from '../src/types'

// A ProjectRole carrying the legacy free-text fields that older saves had.
type LegacyRole = ProjectRole & { long_description?: Record<string, string>; summary?: Record<string, string> }

function legacyRole(over: Partial<LegacyRole> = {}): LegacyRole {
  return {
    id: 'pr-1', role_id: 'r-1', name: {}, sort_order: 0, disabled: false,
    long_description: {}, summary: {},
    ...over,
  }
}

describe('appendLocalized()', () => {
  it('joins non-empty values per locale with a blank line', () => {
    const out = appendLocalized({ en: 'First' }, { en: 'Second', no: 'Andre' })
    expect(out.en).toBe('First\n\nSecond')
    expect(out.no).toBe('Andre')
  })

  it('ignores empty / whitespace additions', () => {
    const out = appendLocalized({ en: 'First' }, { en: '   ', no: '' })
    expect(out.en).toBe('First')
    expect(out.no).toBeUndefined()
  })

  it('returns a copy of base when addition is undefined', () => {
    const base = { en: 'Only' }
    const out = appendLocalized(base, undefined)
    expect(out).toEqual(base)
    expect(out).not.toBe(base)
  })
})

describe('buildRoleParagraph()', () => {
  it('prefixes the role name and combines long_description + summary', () => {
    const out = buildRoleParagraph({
      name: { en: 'Architect' },
      long_description: { en: 'Designed it.' },
      summary: { en: 'In short, led design.' },
    })
    expect(out.en).toBe('Architect: Designed it.\n\nIn short, led design.')
  })

  it('omits locales that have no role text', () => {
    const out = buildRoleParagraph({ name: { en: 'Dev', no: 'Utvikler' }, long_description: { en: 'Built things.' } })
    expect(out.en).toBe('Dev: Built things.')
    expect(out.no).toBeUndefined()
  })

  it('falls back to bare text when no name for that locale', () => {
    const out = buildRoleParagraph({ name: {}, long_description: { en: 'Did work.' } })
    expect(out.en).toBe('Did work.')
  })
})

describe('foldRoleDescriptions()', () => {
  it('folds legacy role text into the project long_description and strips the fields', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      long_description: { en: 'Background.' },
      roles: [legacyRole({ name: { en: 'Lead' }, long_description: { en: 'Ran the team.' } })],
    }))

    const out = foldRoleDescriptions(store)
    expect(out.projects[0].long_description.en).toBe('Background.\n\nLead: Ran the team.')
    const role = out.projects[0].roles[0] as LegacyRole
    expect('long_description' in role).toBe(false)
    expect('summary' in role).toBe(false)
    // Registry linkage and identity are preserved.
    expect(role.id).toBe('pr-1')
    expect(role.role_id).toBe('r-1')
  })

  it('is idempotent — running twice does not duplicate text', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      long_description: {},
      roles: [legacyRole({ name: { en: 'Lead' }, long_description: { en: 'Ran the team.' } })],
    }))
    const once  = foldRoleDescriptions(store)
    const twice = foldRoleDescriptions(once)
    expect(twice.projects[0].long_description.en).toBe('Lead: Ran the team.')
    // Second pass is a true no-op: same reference back.
    expect(twice).toBe(once)
  })

  it('returns the same store reference when no roles carry legacy fields', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      roles: [{ id: 'pr-1', role_id: 'r-1', name: { en: 'Dev' }, sort_order: 0, disabled: false }],
    }))
    expect(foldRoleDescriptions(store)).toBe(store)
  })

  it('handles multiple locales independently', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      long_description: { en: 'EN bg.', no: 'NO bg.' },
      roles: [legacyRole({
        name: { en: 'Lead', no: 'Leder' },
        long_description: { en: 'Did EN.', no: 'Gjorde NO.' },
      })],
    }))
    const out = foldRoleDescriptions(store)
    expect(out.projects[0].long_description.en).toBe('EN bg.\n\nLead: Did EN.')
    expect(out.projects[0].long_description.no).toBe('NO bg.\n\nLeder: Gjorde NO.')
  })
})
