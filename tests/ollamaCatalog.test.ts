import { describe, it, expect } from 'vitest'
import { OLLAMA_CATALOG, modelOptions, fmtModelSize } from '../src/lib/ollamaCatalog'

describe('OLLAMA_CATALOG', () => {
  it('is ordered by parameter count, smallest first', () => {
    // Params, not download size: sizes aren't monotonic across families because
    // quantisation differs (llama3.2:1b is 1.3 GB, qwen2.5:1.5b only 1.0 GB).
    // Parameter count is what the user reasons about, so that's the order.
    const params = OLLAMA_CATALOG.map((c) => parseFloat(c.params))
    expect([...params].sort((a, b) => a - b)).toEqual(params)
  })

  it('every entry has a pullable-looking tag and a size', () => {
    for (const c of OLLAMA_CATALOG) {
      // Ollama tags are name:tag — the field is free-text, but the catalog
      // should only ever suggest fully-qualified tags.
      expect(c.name, c.name).toMatch(/^[a-z0-9][a-z0-9._-]*:[a-z0-9._-]+$/i)
      expect(c.params, c.name).toBeTruthy()
      expect(c.sizeGb, c.name).toBeGreaterThan(0)
    }
  })

  it('has no duplicate tags', () => {
    const names = OLLAMA_CATALOG.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('fmtModelSize()', () => {
  it('renders GB for large models and MB for small ones', () => {
    expect(fmtModelSize(2_000_000_000)).toBe('~2.0 GB')
    expect(fmtModelSize(400_000_000)).toBe('~400 MB')
  })
  it('is blank for an unknown/zero size', () => {
    expect(fmtModelSize(0)).toBe('')
    expect(fmtModelSize(-1)).toBe('')
  })

  it('switches units at exactly one gigabyte', () => {
    // Only well clear of the boundary was tested, so moving it left a model of
    // exactly 1 GB reported as "1000 MB".
    expect(fmtModelSize(1e9)).toBe('~1.0 GB')
    expect(fmtModelSize(999_000_000)).toBe('~999 MB')
  })
})

describe('modelOptions()', () => {
  it('offers the whole catalog when nothing is installed', () => {
    const opts = modelOptions([])
    expect(opts).toHaveLength(OLLAMA_CATALOG.length)
    expect(opts.every((o) => !o.installed)).toBe(true)
    expect(opts[0].label).toContain('GB download')
  })

  it('lists installed models first and marks them', () => {
    const opts = modelOptions([{ name: 'mistral:7b', size: 4_100_000_000 }])
    expect(opts[0]).toMatchObject({ name: 'mistral:7b', installed: true })
    expect(opts[0].label).toContain('Installed')
    expect(opts[0].label).toContain('~4.1 GB')
  })

  it('does not list an installed model twice via the catalog', () => {
    // mistral:7b is in the catalog AND installed — one entry, the installed one.
    const opts = modelOptions([{ name: 'mistral:7b' }])
    expect(opts.filter((o) => o.name === 'mistral:7b')).toHaveLength(1)
    expect(opts.find((o) => o.name === 'mistral:7b')!.installed).toBe(true)
  })

  it('keeps an installed model the catalog has never heard of', () => {
    // The point of Refresh: surface whatever the user actually pulled.
    const opts = modelOptions([{ name: 'my-org/custom-tune:latest' }])
    expect(opts[0].name).toBe('my-org/custom-tune:latest')
    expect(opts[0].installed).toBe(true)
  })

  it('ignores blank/duplicate names from the instance', () => {
    const opts = modelOptions([{ name: '  ' }, { name: 'llama3.2:3b' }, { name: 'llama3.2:3b' }])
    expect(opts.filter((o) => o.name === 'llama3.2:3b')).toHaveLength(1)
    expect(opts.some((o) => !o.name.trim())).toBe(false)
  })
})

describe('the model list a user picks from', () => {
  it('labels an installed model with its size, and without a stray separator when it has none', () => {
    const list = modelOptions([{ name: 'llama3', size: 4_000_000_000 }, { name: 'sizeless' }])
    const installed = Object.fromEntries(list.filter((m) => m.installed).map((m) => [m.name, m.label]))
    expect(installed.llama3).toMatch(/^Installed · /)
    expect(installed.sizeless).toBe('Installed')
  })

  it('labels a catalog model with its parameter count and download size', () => {
    const c = OLLAMA_CATALOG[0]
    const row = modelOptions([]).find((m) => m.name === c.name)!
    expect(row.installed).toBe(false)
    expect(row.label).toContain(c.params)
    expect(row.label).toContain('GB download')
  })

  it('appends a catalog note only for the models that have one', () => {
    const list = modelOptions([])
    for (const c of OLLAMA_CATALOG) {
      const row = list.find((m) => m.name === c.name)!
      if (c.note) expect(row.label, c.name).toContain(c.note)
      // No note must not leave a trailing separator.
      else expect(row.label.endsWith(' · '), c.name).toBe(false)
    }
  })
})
