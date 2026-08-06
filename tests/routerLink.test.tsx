// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, isPlainLeftClick, useRoute } from '../src/lib/router'
import type { MouseEvent } from 'react'

/**
 * Navigation is REAL LINKS, not onClick (CLAUDE.md §1).
 *
 * Every sidebar item is an <a href> so Ctrl/Cmd-click, middle-click and "Open
 * in new tab" work — two sections of one CV side by side is a genuine editing
 * need. `<Link>` and `isPlainLeftClick` had 15 mutants between them and no test
 * called either, though the rule they enforce is written down: anything a nav
 * item does IN ADDITION to navigating must ask isPlainLeftClick first, or
 * opening a section in a second tab also moves the tab you are still reading.
 */
beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('isPlainLeftClick', () => {
  const ev = (over: Partial<MouseEvent<HTMLElement>>) =>
    ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over }) as MouseEvent<HTMLElement>

  it('is true for an unmodified left click', () => {
    expect(isPlainLeftClick(ev({}))).toBe(true)
  })

  it('is false for every modifier the browser gives a meaning to', () => {
    // Each of these means "open this somewhere else"; treating any of them as
    // an in-place navigation moves the tab the user is still reading.
    expect(isPlainLeftClick(ev({ metaKey: true }))).toBe(false)
    expect(isPlainLeftClick(ev({ ctrlKey: true }))).toBe(false)
    expect(isPlainLeftClick(ev({ shiftKey: true }))).toBe(false)
    expect(isPlainLeftClick(ev({ altKey: true }))).toBe(false)
  })

  it('is false for a middle or right click', () => {
    expect(isPlainLeftClick(ev({ button: 1 }))).toBe(false)
    expect(isPlainLeftClick(ev({ button: 2 }))).toBe(false)
  })
})

describe('<Link>', () => {
  it('renders a real anchor with a real href', () => {
    // The href is what makes right-click "Open in new tab" and middle-click
    // work at all — an onClick-only control offers neither.
    render(<Link to="/r/abc/projects">Projects</Link>)
    expect(screen.getByRole('link', { name: 'Projects' }))
      .toHaveAttribute('href', '/r/abc/projects')
  })

  it('builds the href from a Route object too', () => {
    render(<Link to={{ name: 'editor', id: 'a b', section: 'views', viewId: 'v1' }}>View</Link>)
    expect(screen.getByRole('link', { name: 'View' }))
      .toHaveAttribute('href', '/r/a%20b/views/v1')
  })

  it('navigates in place on a plain left click, without a page load', async () => {
    render(<Link to="/r/abc/projects">Projects</Link>)
    await userEvent.click(screen.getByRole('link', { name: 'Projects' }))
    expect(window.location.pathname).toBe('/r/abc/projects')
  })

  it('pushes history by default, and replaces when asked', async () => {
    const push = vi.spyOn(window.history, 'pushState')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')

    render(<Link to="/r/abc/projects">Push</Link>)
    await userEvent.click(screen.getByRole('link', { name: 'Push' }))
    expect(push).toHaveBeenCalled()

    push.mockClear()
    replaceSpy.mockClear()
    render(<Link to="/r/abc/courses" replace>Replace</Link>)
    await userEvent.click(screen.getByRole('link', { name: 'Replace' }))
    expect(replaceSpy).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('leaves a modified click to the BROWSER', async () => {
    // The whole point: Ctrl-click must not navigate this tab. If it did, the
    // new tab opens AND the tab you were reading jumps.
    // ONE userEvent instance: the direct API creates a fresh one per call, so
    // the held modifier would be dropped before the click.
    const user = userEvent.setup()
    render(<Link to="/r/abc/projects">Projects</Link>)
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('link', { name: 'Projects' }))
    await user.keyboard('{/Control}')
    expect(window.location.pathname).toBe('/')
  })

  it('calls the caller’s onClick, and lets it cancel the navigation', async () => {
    // A nav item that also closes a drawer hangs its work off onClick; calling
    // preventDefault there has to stop the navigation too.
    const onClick = vi.fn((e: MouseEvent<HTMLAnchorElement>) => { e.preventDefault() })
    render(<Link to="/r/abc/projects" onClick={onClick}>Projects</Link>)
    await userEvent.click(screen.getByRole('link', { name: 'Projects' }))
    expect(onClick).toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
  })

  it('passes extra props through to the anchor', () => {
    render(<Link to="/" className="nav-item" aria-current="page">Home</Link>)
    const a = screen.getByRole('link', { name: 'Home' })
    expect(a).toHaveClass('nav-item')
    expect(a).toHaveAttribute('aria-current', 'page')
  })
})

describe('useRoute', () => {
  function Probe() {
    const route = useRoute()
    return <span data-testid="route">{JSON.stringify(route)}</span>
  }

  it('parses the current URL', () => {
    window.history.replaceState({}, '', '/r/abc/projects')
    render(<Probe />)
    expect(JSON.parse(screen.getByTestId('route').textContent!))
      .toEqual({ name: 'editor', id: 'abc', section: 'projects' })
  })

  it('re-renders when a <Link> navigates', async () => {
    render(<><Probe /><Link to="/r/abc/courses">Go</Link></>)
    expect(JSON.parse(screen.getByTestId('route').textContent!)).toEqual({ name: 'picker' })
    await userEvent.click(screen.getByRole('link', { name: 'Go' }))
    expect(JSON.parse(screen.getByTestId('route').textContent!))
      .toEqual({ name: 'editor', id: 'abc', section: 'courses' })
  })
})
