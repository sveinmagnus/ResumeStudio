/**
 * @vitest-environment jsdom
 *
 * Publishing resumes' registries to the instance-level shared registry.
 *
 * The planning half (`registrySync`) is pure and already covered; this is the
 * I/O orchestration around it, and it had none. The property that matters is
 * the one the module was written for: a skill first seen in resume A must be
 * CREATED once and then LINKED when resume B is processed — cross-resume dedup
 * falls out of the ordering, and a regression here silently duplicates every
 * shared entry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { publishToInstanceRegistry } from '../src/lib/registryPublish'
import { api, ConflictError } from '../src/lib/api'
import { registryKey } from '../src/lib/registrySync'
import { emptyStore, makeSkill } from './fixtures'
import type { RegistryEntry, ResumeStore } from '../src/types'

function storeWithSkill(name: string): ResumeStore {
  return { ...emptyStore(), skills: [makeSkill({ name: { en: name } })] }
}

// The kind is singular ('skill') and the key is the shared dedup key — both
// have to match what planPublish indexes by, or every entry looks new.
const entry = (id: string, name: string): RegistryEntry => ({
  id, kind: 'skill', name: { en: name }, key: registryKey('skill', name),
  extra: {}, updated_at: '2026-01-01T00:00:00Z', version: 1,
})

beforeEach(() => { vi.restoreAllMocks() })

describe('publishToInstanceRegistry', () => {
  it('creates a canonical entry, links the resume to it, and saves', async () => {
    const store = storeWithSkill('Kubernetes')
    vi.spyOn(api, 'listRegistry').mockResolvedValue([])
    const create = vi.spyOn(api, 'createRegistryEntry')
      .mockResolvedValue(entry('canon-1', 'Kubernetes'))
    const save = vi.spyOn(api, 'saveResume').mockResolvedValue({ saved_at: 'x', version: 2 })

    const res = await publishToInstanceRegistry([{ id: 'r1', data: store, version: 1 }])

    expect(res).toEqual({ created: 1, linked: 0, saved: 1, conflicts: 0 })
    expect(create).toHaveBeenCalledTimes(1)
    // …and it carries what the entry IS. Called with an empty object the count
    // is still 1, and the instance registry fills with nameless rows.
    expect(create.mock.calls[0][0]).toMatchObject({ kind: 'skill', name: { en: 'Kubernetes' } })
    // The saved store carries the link back to the canonical entry.
    const saved = save.mock.calls[0][1] as ResumeStore
    expect(saved.skills[0].canonical_id).toBe('canon-1')
    // Saved at the version we were given, so a concurrent edit is caught.
    expect(save.mock.calls[0][3]).toBe(1)
  })

  it('creates once across resumes, then links — the whole point of the ordering', async () => {
    vi.spyOn(api, 'listRegistry').mockResolvedValue([])
    const create = vi.spyOn(api, 'createRegistryEntry')
      .mockResolvedValue(entry('canon-1', 'Kubernetes'))
    vi.spyOn(api, 'saveResume').mockResolvedValue({ saved_at: 'x', version: 2 })

    const res = await publishToInstanceRegistry([
      { id: 'r1', data: storeWithSkill('Kubernetes'), version: 1 },
      { id: 'r2', data: storeWithSkill('Kubernetes'), version: 1 },
    ])

    expect(create).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ created: 1, linked: 1, saved: 2 })
  })

  it('links to an entry that already exists rather than creating a second', async () => {
    vi.spyOn(api, 'listRegistry').mockResolvedValue([entry('canon-1', 'Kubernetes')])
    const create = vi.spyOn(api, 'createRegistryEntry')
    vi.spyOn(api, 'saveResume').mockResolvedValue({ saved_at: 'x', version: 2 })

    const res = await publishToInstanceRegistry([
      { id: 'r1', data: storeWithSkill('Kubernetes'), version: 1 },
    ])

    expect(create).not.toHaveBeenCalled()
    expect(res).toMatchObject({ created: 0, linked: 1, saved: 1 })
  })

  it('skips a resume with nothing to publish, without saving it', async () => {
    vi.spyOn(api, 'listRegistry').mockResolvedValue([])
    const save = vi.spyOn(api, 'saveResume')

    const res = await publishToInstanceRegistry([{ id: 'r1', data: emptyStore(), version: 1 }])

    expect(save).not.toHaveBeenCalled()
    expect(res).toEqual({ created: 0, linked: 0, saved: 0, conflicts: 0 })
  })

  /** Someone edited that resume meanwhile: count it, carry on, re-run later. */
  it('counts a conflicted save and keeps going with the rest', async () => {
    vi.spyOn(api, 'listRegistry').mockResolvedValue([])
    vi.spyOn(api, 'createRegistryEntry')
      .mockResolvedValueOnce(entry('canon-1', 'Kubernetes'))
      .mockResolvedValueOnce(entry('canon-2', 'Terraform'))
    vi.spyOn(api, 'saveResume')
      .mockRejectedValueOnce(new ConflictError({
        data: emptyStore(),
        meta: {
          id: 'r1', name: 'CV', primary_locale: 'en', secondary_locale: null,
          saved_at: 'x', created_at: 'x', version: 9,
        },
      }))
      .mockResolvedValue({ saved_at: 'x', version: 2 })

    const res = await publishToInstanceRegistry([
      { id: 'r1', data: storeWithSkill('Kubernetes'), version: 1 },
      { id: 'r2', data: storeWithSkill('Terraform'), version: 1 },
    ])

    expect(res).toMatchObject({ conflicts: 1, saved: 1 })
  })

  it('lets a real failure through rather than reporting a false success', async () => {
    vi.spyOn(api, 'listRegistry').mockResolvedValue([])
    vi.spyOn(api, 'createRegistryEntry').mockResolvedValue(entry('canon-1', 'Kubernetes'))
    vi.spyOn(api, 'saveResume').mockRejectedValue(new Error('server on fire'))

    await expect(publishToInstanceRegistry([
      { id: 'r1', data: storeWithSkill('Kubernetes'), version: 1 },
    ])).rejects.toThrow('server on fire')
  })
})
