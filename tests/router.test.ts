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
    // The pattern is anchored at BOTH ends. Without the start anchor a path
    // that merely contains /r/… routes into the editor; without the end anchor
    // anything trailing is ignored, so a mistyped deep link silently opens
    // something adjacent instead of reporting itself.
    ['/x/r/abc',               { name: 'not-found', path: '/x/r/abc' }],
    ['/somewhere/r/abc/views/v1', { name: 'not-found', path: '/somewhere/r/abc/views/v1' }],
    ['/r/abc/views/v1/extra',  { name: 'not-found', path: '/r/abc/views/v1/extra' }],
    ['/r/abc/projects/x/y',    { name: 'not-found', path: '/r/abc/projects/x/y' }],
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

describe('parseRoute — a third segment belongs to /views/ only', () => {
  it('accepts a view id under views', () => {
    expect(parseRoute('/r/abc/views/v1')).toEqual({ name: 'editor', id: 'abc', section: 'views', viewId: 'v1' })
  })

  it('rejects a third segment under any other section', () => {
    // Without this the extra segment is silently ignored and the URL resolves
    // to the section, so a typo'd link looks like it worked.
    expect(parseRoute('/r/abc/projects/extra')).toEqual({ name: 'not-found', path: '/r/abc/projects/extra' })
    expect(parseRoute('/r/abc/views')).toEqual({ name: 'editor', id: 'abc', section: 'views' })
  })
})

describe('pathFor — the view path needs BOTH the section and the id', () => {
  it('builds the view path when both are present', () => {
    expect(pathFor({ name: 'editor', id: 'abc', section: 'views', viewId: 'v1' })).toBe('/r/abc/views/v1')
  })

  it('ignores a stray view id on another section', () => {
    expect(pathFor({ name: 'editor', id: 'abc', section: 'projects', viewId: 'v1' })).toBe('/r/abc/projects')
  })

  it('falls back to the section path when the view id is missing', () => {
    expect(pathFor({ name: 'editor', id: 'abc', section: 'views' })).toBe('/r/abc/views')
  })
})

describe('parseRoute — a URL the browser will not decode', () => {
  it('reads a malformed percent-escape as not-found rather than throwing', () => {
    // A hand-edited or truncated link reaches the router before anything else;
    // an uncaught URIError there blanks the whole app instead of showing the
    // not-found screen.
    for (const bad of ['/r/%E0%A4%A', '/r/abc/%', '/r/%ZZ']) {
      expect(parseRoute(bad), bad).toEqual({ name: 'not-found', path: bad })
    }
  })

  it('reads a third segment outside /views/ as not-found', () => {
    expect(parseRoute('/r/abc/projects/extra')).toEqual({ name: 'not-found', path: '/r/abc/projects/extra' })
  })
})
