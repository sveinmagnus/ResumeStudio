import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emptyStore, makeResume, makeSkill } from './fixtures'

/**
 * `downloadBackup` is the one part of lib/backup.ts with side effects: it asks
 * the server for the instance registry, builds the file, and hands it to the
 * download helper. Both edges are mocked, so what is asserted is the wiring —
 * that the registry is embedded when available, that a registry failure still
 * produces a download, and what the file is called.
 */

const listRegistry = vi.fn()
const downloadText = vi.fn()

vi.mock('../src/lib/api', () => ({ api: { listRegistry: () => listRegistry() } }))
vi.mock('../src/lib/download', () => ({ downloadText: (...args: unknown[]) => downloadText(...args) }))

const { downloadBackup } = await import('../src/lib/backup')

beforeEach(() => {
  listRegistry.mockReset()
  downloadText.mockReset()
  listRegistry.mockResolvedValue([])
})

const lastCall = () => downloadText.mock.calls[0] as [string, string, string]

describe('downloadBackup', () => {
  it('downloads the backup as JSON', async () => {
    await downloadBackup(emptyStore())
    expect(downloadText).toHaveBeenCalledTimes(1)
    const [json, , mime] = lastCall()
    expect(mime).toBe('application/json')
    expect(JSON.parse(json).$schema).toBe('resumestudio/v1')
  })

  it('names the file after the person, with spaces collapsed to underscores', () => {
    // Several spaces are one underscore: "Ada  B  Lovelace" must not become
    // "Ada__B__Lovelace", which reads as a broken filename.
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Ada  B Lovelace' })
    return downloadBackup(store).then(() => {
      expect(lastCall()[1]).toBe('Ada_B_Lovelace_backup.json')
    })
  })

  it('replaces every run of whitespace, not just the first', async () => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Ada B Lovelace' })
    await downloadBackup(store)
    expect(lastCall()[1]).toBe('Ada_B_Lovelace_backup.json')
  })

  it('falls back to "resume" when there is no name to use', async () => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: '' })
    await downloadBackup(store)
    expect(lastCall()[1]).toBe('resume_backup.json')
  })

  it('falls back to "resume" when the profile has no name field at all', async () => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: undefined as never })
    await downloadBackup(store)
    expect(lastCall()[1]).toBe('resume_backup.json')
  })

  it('falls back to "resume" when there is no profile at all', async () => {
    const store = emptyStore()
    store.resume = null as never
    await downloadBackup(store)
    expect(lastCall()[1]).toBe('resume_backup.json')
  })

  it('embeds the canonical registry entries the resume references', async () => {
    const store = emptyStore()
    store.skills = [makeSkill({ id: 's1', name: { en: 'Go' }, canonical_id: 'c1' })]
    listRegistry.mockResolvedValue([{ id: 'c1', kind: 'skill', name: { en: 'Go' }, extra: null }])
    await downloadBackup(store)
    expect(JSON.parse(lastCall()[0]).canonical_registry).toBeTruthy()
  })

  it('still downloads when the registry request fails', async () => {
    // Best-effort: the backup is worth more than the embedding.
    listRegistry.mockRejectedValue(new Error('offline'))
    await downloadBackup(emptyStore())
    expect(downloadText).toHaveBeenCalledTimes(1)
    expect(JSON.parse(lastCall()[0]).$schema).toBe('resumestudio/v1')
  })
})
