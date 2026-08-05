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

  it('collapses a RUN of illegal characters into one separator', () => {
    // Without the +, each illegal character becomes its own space and then its
    // own underscore: "Q3 :: Client" turns into "Q3___Client".
    expect(slugifyFilenamePart('Q3 :: Client')).toBe('Q3_Client')
    expect(slugifyFilenamePart('a<<>>b')).toBe('a_b')
  })

  it('strips control characters, which is the point of that range', () => {
    // A stray control character in a CV title travels into a Content-
    // Disposition header; some servers and browsers reject the download
    // outright, and it is invisible in the editor.
    const withControls = `Report${String.fromCharCode(9)}Q3${String.fromCharCode(0)}`
    expect(slugifyFilenamePart(withControls)).toBe('Report_Q3')
    expect(slugifyFilenamePart(String.fromCharCode(1, 2, 3))).toBe('resume')
  })

  it('takes the value it was given, not a hardcoded one', () => {
    // The `?? ''` guards a null; the value has to be what flows on.
    expect(slugifyFilenamePart('Consultant CV')).toBe('Consultant_CV')
  })
})

describe('exportFilename()', () => {
  it('joins slugified name and view with the given extension', () => {
    expect(exportFilename('Kari Nordmann', 'Backend / DevOps', 'pdf')).toBe('Kari_Nordmann_Backend_DevOps.pdf')
    expect(exportFilename('', '', 'docx')).toBe('resume_view.docx')
  })
})
