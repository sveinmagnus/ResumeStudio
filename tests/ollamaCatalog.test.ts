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
