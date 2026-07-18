import { describe, it, expect } from 'vitest'
import { createResumeDb } from '../../server/db'
import { registryKey } from '../../server/registryDb'

const freshDb = () => createResumeDb(':memory:')

describe('registryKey()', () => {
  it('applies the js-alias to skills but not to other kinds', () => {
    expect(registryKey('skill', 'React.js')).toBe(registryKey('skill', 'React'))
    // A role literally named with a trailing "js" token keeps it (no alias).
    expect(registryKey('role', 'Foo js')).toBe('foo js')
  })
})

describe('registry CRUD', () => {
  it('creates an entry at version 1 with a normalized key', () => {
    const db = freshDb()
    const r = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'React.js' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entry.version).toBe(1)
    expect(r.entry.key).toBe('react')
    expect(r.entry.kind).toBe('skill')
  })

  it('lists entries, optionally filtered by kind', () => {
    const db = freshDb()
    db.upsertRegistryEntry({ kind: 'skill', name: { en: 'Go' } })
    db.upsertRegistryEntry({ kind: 'role', name: { en: 'Architect' } })
    expect(db.listRegistry()).toHaveLength(2)
    expect(db.listRegistry('skill')).toHaveLength(1)
    expect(db.listRegistry('role')[0].name.en).toBe('Architect')
  })

  it('updates a name and bumps the version', () => {
    const db = freshDb()
    const created = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'Kubernetes' } })
    if (!created.ok) throw new Error('setup')
    const upd = db.upsertRegistryEntry({ id: created.entry.id, kind: 'skill', name: { en: 'Kubernetes', no: 'Kubernetes' } })
    expect(upd.ok).toBe(true)
    if (!upd.ok) return
    expect(upd.entry.version).toBe(2)
    expect(upd.entry.name.no).toBe('Kubernetes')
  })

  it('rejects an update with a stale expectedVersion (optimistic concurrency)', () => {
    const db = freshDb()
    const created = db.upsertRegistryEntry({ kind: 'role', name: { en: 'SRE' } })
    if (!created.ok) throw new Error('setup')
    // Someone else already bumped it to v2.
    db.upsertRegistryEntry({ id: created.entry.id, kind: 'role', name: { en: 'SRE!' } })
    const stale = db.upsertRegistryEntry({ id: created.entry.id, kind: 'role', name: { en: 'nope' }, expectedVersion: 1 })
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.reason).toBe('conflict')
    if (stale.reason === 'conflict') expect(stale.current.version).toBe(2)
  })

  it('reports not_found for an update to a missing id', () => {
    const db = freshDb()
    const r = db.upsertRegistryEntry({ id: 'ghost', kind: 'skill', name: { en: 'x' } })
    expect(r).toEqual({ ok: false, reason: 'not_found' })
  })

  it('deletes an entry', () => {
    const db = freshDb()
    const created = db.upsertRegistryEntry({ kind: 'industry', name: { en: 'Finance' } })
    if (!created.ok) throw new Error('setup')
    expect(db.deleteRegistryEntry(created.entry.id)).toBe(true)
    expect(db.getRegistryEntry(created.entry.id)).toBeNull()
    expect(db.deleteRegistryEntry(created.entry.id)).toBe(false)
  })

  it('persists skill extras (classification / category link)', () => {
    const db = freshDb()
    const r = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'Go' }, extra: { classification: 'Technical', category_id: 'cat1' } })
    if (!r.ok) throw new Error('setup')
    expect(db.getRegistryEntry(r.entry.id)?.extra).toEqual({ classification: 'Technical', category_id: 'cat1' })
  })
})

describe('promoteFromResumes()', () => {
  // Minimal resume-data blobs (only the registry arrays matter here).
  // NB: the dedup key is a name's first-locale normalization, so union catches
  // the same SPELLING across resumes ("Finance"/"Finance"), not two different
  // language words for one concept ("Finance"/"Finans") — those normalize to
  // different keys and stay separate, resolved by the registry merge UI (same
  // as per-resume today). resumeB adds a `no` locale to the shared "Finance".
  const resumeA = {
    skills: [{ name: { en: 'React' } }, { name: { en: 'Go' } }],
    roles: [{ name: { en: 'Architect' } }],
    industries: [{ name: { en: 'Finance' } }],
    skill_categories: [{ name: { en: 'Cloud' } }],
  }
  const resumeB = {
    skills: [{ name: { en: 'React.js' } }, { name: { en: 'Kafka' } }], // React.js ≡ React
    roles: [{ name: { en: 'Architect' } }],                            // dup of A's
    industries: [{ name: { en: 'Finance', no: 'Finans' } }],           // same key → union adds `no`
    skill_categories: [],
  }

  it('unions registries across resumes by normalized key', () => {
    const db = freshDb()
    const summary = db.promoteFromResumes([resumeA, resumeB])

    // Skills: React(.js) collapses → React, Go, Kafka = 3 canonical.
    expect(db.listRegistry('skill')).toHaveLength(3)
    // One Architect role across both; one Finance industry; one Cloud category.
    expect(db.listRegistry('role')).toHaveLength(1)
    expect(db.listRegistry('industry')).toHaveLength(1)
    expect(db.listRegistry('category')).toHaveLength(1)
    expect(summary.created.skill).toBe(3)
    expect(summary.created.role).toBe(1)
  })

  it('merges localized names rather than duplicating (Finans → Finance/Finans)', () => {
    const db = freshDb()
    db.promoteFromResumes([resumeA, resumeB])
    const finance = db.listRegistry('industry')[0]
    expect(finance.name.en).toBe('Finance')
    expect(finance.name.no).toBe('Finans')
  })

  it('is idempotent — re-running creates nothing new', () => {
    const db = freshDb()
    db.promoteFromResumes([resumeA, resumeB])
    const before = db.listRegistry().length
    const second = db.promoteFromResumes([resumeA, resumeB])
    expect(db.listRegistry().length).toBe(before)
    expect(second.created).toEqual({ skill: 0, role: 0, industry: 0, category: 0 })
  })

  it('tolerates junk data blobs without throwing', () => {
    const db = freshDb()
    expect(() => db.promoteFromResumes([null, 'nope', 42, {}, { skills: 'not-an-array' }])).not.toThrow()
    expect(db.listRegistry()).toEqual([])
  })
})
