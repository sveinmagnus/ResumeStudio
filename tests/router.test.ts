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
    // Section + view deep links
    ['/r/abc/projects',        { name: 'editor', id: 'abc', section: 'projects' }],
    ['/r/abc/projects/',       { name: 'editor', id: 'abc', section: 'projects' }],
    ['/r/abc/views',           { name: 'editor', id: 'abc', section: 'views' }],
    ['/r/abc/views/v1',        { name: 'editor', id: 'abc', section: 'views', viewId: 'v1' }],
    ['/r/abc/projects/x',      { name: 'not-found', path: '/r/abc/projects/x' }], // 3rd segment only under /views/
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

  it('builds section and view paths; overview stays canonical (no suffix)', () => {
    expect(pathFor({ name: 'editor', id: 'abc', section: 'overview' })).toBe('/r/abc')
    expect(pathFor({ name: 'editor', id: 'abc', section: 'projects' })).toBe('/r/abc/projects')
    expect(pathFor({ name: 'editor', id: 'abc', section: 'views' })).toBe('/r/abc/views')
    expect(pathFor({ name: 'editor', id: 'abc', section: 'views', viewId: 'v1' })).toBe('/r/abc/views/v1')
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

  it('section and view routes survive a round-trip', () => {
    const section: Route = { name: 'editor', id: 'abc', section: 'projects' }
    expect(parseRoute(pathFor(section))).toEqual(section)
    const view: Route = { name: 'editor', id: 'abc', section: 'views', viewId: 'v 1' }
    expect(parseRoute(pathFor(view))).toEqual(view)
  })
})
