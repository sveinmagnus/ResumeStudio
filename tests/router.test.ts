import { describe, it, expect } from 'vitest'
import { parseRoute, pathFor, type Route } from '../src/lib/router'

describe('parseRoute', () => {
  const cases: Array<[string, Route]> = [
    ['/',                      { name: 'picker' }],
    ['',                       { name: 'picker' }],
    ['/r/abc',                 { name: 'editor', id: 'abc' }],
    ['/r/abc/',                { name: 'editor', id: 'abc' }],  // trailing slash tolerated
    ['/r/uuid-1234-5678',      { name: 'editor', id: 'uuid-1234-5678' }],
    ['/r/a%20b',               { name: 'editor', id: 'a b' }],  // percent-decoded
    ['/nope',                  { name: 'not-found', path: '/nope' }],
    ['/r',                     { name: 'not-found', path: '/r' }],
    ['/r/',                    { name: 'not-found', path: '/r/' }],   // empty id segment
    ['/r/a/b',                 { name: 'not-found', path: '/r/a/b' }], // nested not matched
  ]

  it.each(cases)('parses %j', (path, expected) => {
    expect(parseRoute(path)).toEqual(expected)
  })

  // Regression: decodeURIComponent throws URIError on a malformed escape.
  // parseRoute runs in render outside any ErrorBoundary, so a throw would
  // white-screen the whole app. It must degrade to not-found instead.
  it.each(['/r/%', '/r/%E0%A4%A', '/r/%zz'])(
    'does not throw on malformed escape %s — falls back to not-found',
    (path) => {
      expect(() => parseRoute(path)).not.toThrow()
      expect(parseRoute(path)).toEqual({ name: 'not-found', path })
    },
  )
})

describe('pathFor', () => {
  it('builds the picker path', () => {
    expect(pathFor({ name: 'picker' })).toBe('/')
  })

  it('builds and encodes the editor path', () => {
    expect(pathFor({ name: 'editor', id: 'abc' })).toBe('/r/abc')
    expect(pathFor({ name: 'editor', id: 'a b' })).toBe('/r/a%20b')
  })

  it('passes a not-found path through', () => {
    expect(pathFor({ name: 'not-found', path: '/whatever' })).toBe('/whatever')
  })
})

describe('parseRoute ∘ pathFor round-trip', () => {
  it.each(['simple', 'uuid-1234', 'has space', 'sym/bol', 'a%b'])(
    'editor id %j survives a path round-trip',
    (id) => {
      const route: Route = { name: 'editor', id }
      expect(parseRoute(pathFor(route))).toEqual(route)
    },
  )
})
