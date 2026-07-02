import { describe, it, expect } from 'vitest'
import { slugifyFilenamePart, exportFilename } from '../src/lib/exportFilename'

describe('slugifyFilenamePart()', () => {
  it('replaces Windows-illegal characters with underscores', () => {
    expect(slugifyFilenamePart('Backend / DevOps')).toBe('Backend_DevOps')
    expect(slugifyFilenamePart('Q3: Client "A" <draft>')).toBe('Q3_Client_A_draft')
    expect(slugifyFilenamePart('a\\b*c?d|e')).toBe('a_b_c_d_e')
  })

  it('collapses whitespace runs and trims leading/trailing dots and underscores', () => {
    expect(slugifyFilenamePart('  spaced   out  ')).toBe('spaced_out')
    expect(slugifyFilenamePart('...hidden...')).toBe('hidden')
    expect(slugifyFilenamePart('__edge__')).toBe('edge')
  })

  it('falls back for empty / whitespace / only-illegal input', () => {
    expect(slugifyFilenamePart('')).toBe('resume')
    expect(slugifyFilenamePart('   ')).toBe('resume')
    expect(slugifyFilenamePart('///')).toBe('resume')
    expect(slugifyFilenamePart(null, 'view')).toBe('view')
    expect(slugifyFilenamePart(undefined)).toBe('resume')
  })

  it('caps very long parts', () => {
    expect(slugifyFilenamePart('x'.repeat(200)).length).toBe(80)
  })
})

describe('exportFilename()', () => {
  it('joins slugified name and view with the given extension', () => {
    expect(exportFilename('Kari Nordmann', 'Backend / DevOps', 'pdf')).toBe('Kari_Nordmann_Backend_DevOps.pdf')
    expect(exportFilename('', '', 'docx')).toBe('resume_view.docx')
  })
})
