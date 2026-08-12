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

describe('the filename sanitiser, step by step', () => {
  it('collapses each transformation the slug depends on', () => {
    // One assertion per rewrite the function performs, so losing any single one
    // shows up here rather than as an odd filename in a download folder.
    expect(slugifyFilenamePart('a<<>>b')).toBe('a_b')
    expect(slugifyFilenamePart('  Backend / DevOps  ')).toBe('Backend_DevOps')
    expect(slugifyFilenamePart('..hidden..')).toBe('hidden')
    expect(slugifyFilenamePart('___Ada___')).toBe('Ada')
    expect(slugifyFilenamePart('x'.repeat(120))).toHaveLength(80)
    expect(slugifyFilenamePart('   ')).toBe('resume')
    expect(slugifyFilenamePart('***', 'view')).toBe('view')
  })

  it('turns a RUN of illegal characters into ONE separator', () => {
    // "a<<>>b" must not become "a____b" — the run is one boundary, not four.
    expect(slugifyFilenamePart('a<<>>b')).toBe(slugifyFilenamePart('a<b'))
  })

  it('treats control characters as illegal, like the Windows-reserved set', () => {
    expect(slugifyFilenamePart(`a\u0000\u001fb`)).toBe(slugifyFilenamePart('a<b'))
  })

  it('handles an absent input as an empty one', () => {
    expect(slugifyFilenamePart(undefined)).toBe(slugifyFilenamePart(''))
    expect(slugifyFilenamePart(null as never)).toBe(slugifyFilenamePart(''))
  })
})
