import { describe, it, expect } from 'vitest'
import {
  referencedCanonicalIds, collectReferencedCanonical, planReintern,
  remapCanonicalIds, reinternBackupLinks, type ReinternApi,
} from '../src/lib/registryReintern'
import { emptyStore, makeSkill, makeRole, makeSkillCategory } from './fixtures'
import type { RegistryEntry, CanonicalSnapshot, ResumeStore } from '../src/types'

function entry(over: Partial<RegistryEntry> & Pick<RegistryEntry, 'id' | 'kind' | 'name' | 'key'>): RegistryEntry {
  return { extra: {}, version: 1, updated_at: '2026-01-01T00:00:00Z', ...over }
}
function snap(id: string, kind: CanonicalSnapshot['kind'], key: string, name = { en: id }): CanonicalSnapshot {
  return { id, kind, name, key }
}

describe('referencedCanonicalIds()', () => {
  it('collects canonical_id across kinds, ignoring unlinked entries', () => {
    const store: ResumeStore = {
      ...emptyStore(),
      skills: [makeSkill({ canonical_id: 'a' }), makeSkill({})],
      roles: [makeRole({ canonical_id: 'b' })],
    }
    expect([...referencedCanonicalIds(store)].sort()).toEqual(['a', 'b'])
  })
})

describe('collectReferencedCanonical()', () => {
  it('embeds only the canonical entries the store links to, as identity snapshots', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ canonical_id: 'c1' })] }
    const canonical = [
      entry({ id: 'c1', kind: 'skill', name: { en: 'React' }, key: 'react', extra: { classification: 'FE' } }),
      entry({ id: 'c2', kind: 'skill', name: { en: 'Go' }, key: 'go' }), // not referenced
    ]
    expect(collectReferencedCanonical(store, canonical)).toEqual([
      { id: 'c1', kind: 'skill', name: { en: 'React' }, key: 'react' }, // version/extra dropped
    ])
  })

  it('returns [] when nothing links', () => {
    expect(collectReferencedCanonical(emptyStore(), [entry({ id: 'c1', kind: 'skill', name: {}, key: 'x' })])).toEqual([])
  })
})

describe('planReintern()', () => {
  it('maps a snapshot to a target entry with the same key', () => {
    const plan = planReintern([snap('old1', 'skill', 'react')], [entry({ id: 'new1', kind: 'skill', name: { en: 'React' }, key: 'react' })])
    expect(plan.idMap).toEqual({ old1: 'new1' })
    expect(plan.toCreate).toEqual([])
  })

  it('queues a create when no target matches', () => {
    const plan = planReintern([snap('old1', 'skill', 'rust')], [])
    expect(plan.idMap).toEqual({})
    expect(plan.toCreate.map((s) => s.id)).toEqual(['old1'])
  })

  it('queues only ONE create for same-key snapshots (dedup within the backup)', () => {
    const plan = planReintern([snap('o1', 'skill', 'react'), snap('o2', 'skill', 'react')], [])
    expect(plan.toCreate).toHaveLength(1)
  })

  it('separates by kind — a skill and role with the same key are distinct', () => {
    const plan = planReintern([snap('s', 'skill', 'lead'), snap('r', 'role', 'lead')], [])
    expect(plan.toCreate).toHaveLength(2)
  })
})

describe('remapCanonicalIds()', () => {
  it('rewrites links through the map', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', canonical_id: 'old' })] }
    const out = remapCanonicalIds(store, { old: 'new' })
    expect(out.skills[0].canonical_id).toBe('new')
  })

  it('CLEARS a link with no mapping (never leave a foreign dangling id)', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', canonical_id: 'gone' })] }
    expect(remapCanonicalIds(store, {}).skills[0].canonical_id).toBeNull()
  })

  it('returns the same store ref when nothing links', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1' })] }
    expect(remapCanonicalIds(store, { a: 'b' })).toBe(store)
  })

  it('leaves an entry whose id already points where the map says', () => {
    // Same object back, not a rebuilt copy: a rewritten entry is a change the
    // sync then has to carry and show as a difference.
    const same = makeSkill({ id: 's1', canonical_id: 'keep' })
    const store = { ...emptyStore(), skills: [same] }
    expect(remapCanonicalIds(store, { keep: 'keep' }).skills[0]).toBe(same)
  })

  it('remaps skill categories too, not only the three main registries', () => {
    const store = {
      ...emptyStore(),
      skills: [makeSkill({ id: 's1', canonical_id: 'old' })],
      skill_categories: [makeSkillCategory({ id: 'c1', canonical_id: 'old' })],
    }
    const out = remapCanonicalIds(store, { old: 'new' })
    expect(out.skill_categories[0].canonical_id).toBe('new')
  })

  it('works on a store predating skill categories', () => {
    const legacy = { ...emptyStore(), skills: [makeSkill({ id: 's1', canonical_id: 'old' })] }
    delete (legacy as unknown as Record<string, unknown>).skill_categories
    expect(remapCanonicalIds(legacy as never, { old: 'new' }).skills[0].canonical_id).toBe('new')
  })
})

describe('reinternBackupLinks() orchestrator', () => {
  /** A fake instance registry: seeded entries, records creates. */
  function fakeApi(seed: RegistryEntry[]): ReinternApi & { created: RegistryEntry[] } {
    const created: RegistryEntry[] = []
    let n = 0
    return {
      created,
      async listRegistry() { return seed },
      async createRegistryEntry({ kind, name }) {
        const e = entry({ id: `srv-${++n}`, kind, name, key: `k${n}` })
        created.push(e)
        return e
      },
    }
  }

  it('reuses a target entry that matches by key', async () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', name: { en: 'React' }, canonical_id: 'backup-react' })] }
    const embedded = [snap('backup-react', 'skill', 'react')]
    const api = fakeApi([entry({ id: 'target-react', kind: 'skill', name: { en: 'React' }, key: 'react' })])
    const out = await reinternBackupLinks(store, embedded, api)
    expect(out.skills[0].canonical_id).toBe('target-react')
    expect(api.created).toHaveLength(0) // reused, not created
  })

  it('creates a canonical entry on the target when the key is new, and links to it', async () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', name: { en: 'Rust' }, canonical_id: 'backup-rust' })] }
    const embedded = [snap('backup-rust', 'skill', 'rust', { en: 'Rust' })]
    const api = fakeApi([])
    const out = await reinternBackupLinks(store, embedded, api)
    expect(api.created).toHaveLength(1)
    expect(out.skills[0].canonical_id).toBe(api.created[0].id)
  })

  it('clears a link whose snapshot was NOT embedded (no dangling foreign id)', async () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', canonical_id: 'orphan' })] }
    const out = await reinternBackupLinks(store, [], fakeApi([]))
    expect(out.skills[0].canonical_id).toBeNull()
  })

  it('is a no-op (same ref, no api calls) when the store has no links', async () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1' })] }
    const api = fakeApi([])
    let listed = 0
    const counted: ReinternApi = {
      listRegistry: () => { listed++; return api.listRegistry() },
      createRegistryEntry: (input) => api.createRegistryEntry(input),
    }
    const out = await reinternBackupLinks(store, undefined, counted)
    expect(out).toBe(store)
    // Not merely the same result: an import with no links must not talk to the
    // server at all.
    expect(listed).toBe(0)
    expect(api.created).toHaveLength(0)
  })

  it('links same-key siblings in the backup to the ONE created entry', async () => {
    const store = {
      ...emptyStore(),
      skills: [makeSkill({ id: 's1', canonical_id: 'b1' }), makeSkill({ id: 's2', canonical_id: 'b2' })],
    }
    const embedded = [snap('b1', 'skill', 'react'), snap('b2', 'skill', 'react')]
    const api = fakeApi([])
    const out = await reinternBackupLinks(store, embedded, api)
    expect(api.created).toHaveLength(1)
    const id = api.created[0].id
    expect(out.skills.map((s) => s.canonical_id)).toEqual([id, id])
  })
})

describe('what a re-intern actually sends and touches', () => {
  it('creates the entry with the snapshot’s KIND and NAME, not an empty request', () => {
    // The created entry is what every other resume on this instance will link
    // to; an unnamed one is unusable and cannot be repaired from here.
    const requests: Array<{ kind: string; name: unknown }> = []
    const api: ReinternApi = {
      async listRegistry() { return [] },
      async createRegistryEntry(input) {
        requests.push({ kind: input.kind, name: input.name })
        return entry({ id: 'srv-1', kind: input.kind, name: input.name, key: 'k' })
      },
    }
    const store = { ...emptyStore(), roles: [makeRole({ id: 'r1', canonical_id: 'backup-arch' })] }
    return reinternBackupLinks(store, [snap('backup-arch', 'role', 'architect', { en: 'Architect' })], api)
      .then(() => {
        expect(requests).toEqual([{ kind: 'role', name: { en: 'Architect' } }])
      })
  })

  it('returns an UNLINKED entry untouched rather than stamping a null onto it', () => {
    // Adding canonical_id: null where the field never existed rewrites the row
    // on the next save for no reason.
    const store = {
      ...emptyStore(),
      skills: [
        makeSkill({ id: 's1', canonical_id: 'old' }),
        makeSkill({ id: 's2', canonical_id: null }),
        makeSkill({ id: 's3' }),
      ],
    }
    const out = remapCanonicalIds(store, { old: 'new' })
    expect(out.skills[1]).toBe(store.skills[1])
    expect(out.skills[2]).toBe(store.skills[2])
    expect(out.skills[0].canonical_id).toBe('new')
  })
})
