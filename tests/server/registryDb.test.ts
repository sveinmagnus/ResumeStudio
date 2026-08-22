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

  it('accepts an update whose expectedVersion MATCHES', () => {
    // The conflict check has two directions and only the stale one was pinned:
    // mutated to always-conflict, every version-carrying save fails and the
    // stale test still passes. This is the half a working client exercises on
    // every rename.
    const db = freshDb()
    const created = db.upsertRegistryEntry({ kind: 'role', name: { en: 'SRE' } })
    if (!created.ok) throw new Error('setup')
    const upd = db.upsertRegistryEntry({
      id: created.entry.id, kind: 'role', name: { en: 'Platform SRE' }, expectedVersion: 1,
    })
    expect(upd.ok).toBe(true)
    if (upd.ok) expect(upd.entry.version).toBe(2)
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

  it('reuses (does not 500 / duplicate) a create whose (kind, key) already exists', () => {
    const db = freshDb()
    const first = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'React' } })
    if (!first.ok) throw new Error('setup')
    expect(first.created).toBe(true)
    // A second create with a key-equal name (React.js ≡ react) must reuse, not throw.
    const second = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'React.js' } })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.created).toBe(false)
    // Same canonical entry
    expect(second.entry.id).toBe(first.entry.id)
    // No duplicate row
    expect(db.listRegistry('skill')).toHaveLength(1)
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
    // React.js ≡ React
    skills: [{ name: { en: 'React.js' } }, { name: { en: 'Kafka' } }],
    // Dup of A's
    roles: [{ name: { en: 'Architect' } }],
    // Same key → union adds `no`
    industries: [{ name: { en: 'Finance', no: 'Finans' } }],
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
    // And nothing is COUNTED as merged either: a union that added no locale is
    // not written, so a nightly promote reports quiet rather than churn.
    expect(second.merged).toEqual({ skill: 0, role: 0, industry: 0, category: 0 })
  })

  it('does not let a BLANK incoming locale overwrite or fill anything', () => {
    // unionNames fills a locale only when the existing slot is empty AND the
    // incoming value has content. A blank fills nothing — and an incoming
    // blank over existing text must never blank it.
    const db = freshDb()
    db.promoteFromResumes([{ skills: [{ name: { en: 'React', no: 'React' } }] }])
    const merged = db.promoteFromResumes([{ skills: [{ name: { en: 'React', no: '  ', da: '' } }] }])
    expect(merged.merged.skill).toBe(0)
    const entry = db.listRegistry('skill')[0]
    expect(entry.name.no).toBe('React')
    expect(entry.name.da).toBeUndefined()
  })

  it('tolerates junk data blobs without throwing', () => {
    const db = freshDb()
    expect(() => db.promoteFromResumes([null, 'nope', 42, {}, { skills: 'not-an-array' }])).not.toThrow()
    expect(db.listRegistry()).toEqual([])
  })
})

describe('mergeRegistry() — desktop cross-machine sync', () => {
  const entry = (id: string, kind: 'skill' | 'role', key: string, name: Record<string, string>, updated_at: string) =>
    ({ id, kind, name, key, extra: {}, version: 1, updated_at } as const)

  it('inserts a new-key entry with the INCOMING id (so synced resume links resolve)', () => {
    const db = freshDb()
    const r = db.mergeRegistry([entry('remote-1', 'skill', 'react', { en: 'React' }, '2026-01-01T00:00:00Z')])
    expect(r).toEqual({ added: 1, updated: 0 })
    expect(db.getRegistryEntry('remote-1')?.name.en).toBe('React')
  })

  it('newest-wins on a key match, KEEPING the existing id', () => {
    const db = freshDb()
    const local = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'React' } })
    if (!local.ok) throw new Error('setup')
    // Incoming has the same key but a different id and a NEWER timestamp.
    const r = db.mergeRegistry([entry('remote-1', 'skill', 'react', { en: 'ReactJS' }, '2999-01-01T00:00:00Z')])
    expect(r).toEqual({ added: 0, updated: 1 })
    // The existing id is kept; only the name updated.
    expect(db.getRegistryEntry(local.entry.id)?.name.en).toBe('ReactJS')
    expect(db.getRegistryEntry('remote-1')).toBeNull()
  })

  it('keeps the existing entry on an exact timestamp tie', () => {
    // The same strictly-newer rule the sync folder uses (backupFiles): a tie is
    // not a reason to churn, and `>=` here would rewrite every entry on every
    // sync round in which nothing changed.
    const db = freshDb()
    const local = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'React' } })
    if (!local.ok) throw new Error('setup')
    const at = db.getRegistryEntry(local.entry.id)!.updated_at
    const r = db.mergeRegistry([entry('remote-1', 'skill', 'react', { en: 'ReactJS' }, at)])
    expect(r).toEqual({ added: 0, updated: 0 })
    expect(db.getRegistryEntry(local.entry.id)?.name.en).toBe('React')
  })

  it('does NOT overwrite a newer local entry with an older incoming one', () => {
    const db = freshDb()
    const local = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'Local wins' } })
    if (!local.ok) throw new Error('setup')
    const r = db.mergeRegistry([entry('remote-1', 'skill', 'local wins', { en: 'stale' }, '2000-01-01T00:00:00Z')])
    expect(r).toEqual({ added: 0, updated: 0 })
    expect(db.getRegistryEntry(local.entry.id)?.name.en).toBe('Local wins')
  })

  it('never deletes, and skips malformed incoming entries', () => {
    const db = freshDb()
    db.upsertRegistryEntry({ kind: 'role', name: { en: 'SRE' } })
    db.mergeRegistry([{ id: '', kind: 'skill', key: '', name: {}, extra: {}, version: 1, updated_at: '' } as never])
    // Untouched
    expect(db.listRegistry('role')).toHaveLength(1)
  })

  it('skips a colliding-id row (tampered file) instead of aborting the whole merge', () => {
    const db = freshDb()
    const local = db.upsertRegistryEntry({ kind: 'skill', name: { en: 'React' } })
    if (!local.ok) throw new Error('setup')
    // A corrupt file reuses the existing id for a DIFFERENT (kind,key) — the raw
    // INSERT would hit the PRIMARY KEY and throw. It must be skipped, and a valid
    // sibling in the same batch must still merge.
    const r = db.mergeRegistry([
      entry(local.entry.id, 'role', 'architect', { en: 'Architect' }, '2999-01-01T00:00:00Z'),
      entry('remote-good', 'skill', 'go', { en: 'Go' }, '2999-01-01T00:00:00Z'),
    ])
    // Only the valid sibling
    expect(r).toEqual({ added: 1, updated: 0 })
    // Original intact
    expect(db.getRegistryEntry(local.entry.id)?.kind).toBe('skill')
    expect(db.getRegistryEntry('remote-good')?.name.en).toBe('Go')
  })
})
