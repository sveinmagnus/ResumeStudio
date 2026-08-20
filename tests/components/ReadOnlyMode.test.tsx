/**
 * @vitest-environment jsdom
 *
 * A colleague's CV, shared with the team: readable, never writable.
 *
 * The load-bearing assertion is the FIRST one. The server answers a refused
 * write with 404 rather than 403, so that a member cannot enumerate resume ids
 * — which means an edit that got as far as the outbound queue would retry
 * forever against a "not found" and read as data loss on somebody else's CV.
 * The block therefore has to sit at the store's one mutation choke point, not
 * on the controls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '../../src/store/useStore'
import { ReadOnlyNotice } from '../../src/components/ReadOnlyNotice'
import { AppHeader } from '../../src/components/AppHeader'
import { RichField } from '../../src/components/ui/RichField'
import { canWriteResume, type MeInfo, type ResumeMeta } from '../../src/lib/api'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeProject } from '../fixtures'

const OWNER: MeInfo = { user_id: null, name: 'svc', role: 'owner', service: true, mode: 'accounts' }
const KARI: MeInfo = { user_id: 'u-kari', name: 'Kari', role: 'member', service: false, mode: 'accounts' }

const meta = (over: Partial<ResumeMeta> = {}): ResumeMeta => ({
  id: 'r1', name: 'CV', primary_locale: 'en', secondary_locale: null,
  saved_at: 'x', created_at: 'x', version: 1, ...over,
})

beforeEach(() => { resetStore() })
afterEach(() => { vi.restoreAllMocks() })

describe('canWriteResume', () => {
  it('lets an account write what it owns', () => {
    expect(canWriteResume(meta({ owner_id: 'u-kari' }), KARI)).toBe(true)
  })

  it('refuses a member a resume shared by somebody else', () => {
    expect(canWriteResume(meta({ owner_id: 'u-ola', visibility: 'instance' }), KARI)).toBe(false)
  })

  it('refuses a member an UNOWNED resume — it is not shared with everyone', () => {
    expect(canWriteResume(meta({ owner_id: null }), KARI)).toBe(false)
  })

  it('lets the owner role — including a service credential — write anything', () => {
    expect(canWriteResume(meta({ owner_id: 'u-ola' }), OWNER)).toBe(true)
  })

  it('reads a server that reports no ownership at all as writable', () => {
    // Every pre-accounts server and the whole desktop build. Assuming the
    // opposite would lock the single-user case out of its own editor.
    expect(canWriteResume(meta(), KARI)).toBe(true)
    expect(canWriteResume(meta({ owner_id: 'u-ola' }), null)).toBe(true)
  })
})

describe('the store under readOnly', () => {
  const seed = () => {
    const st = useStore.getState()
    st.loadStore({ ...emptyStore(), projects: [makeProject({ id: 'p1' })] })
  }

  it('drops a data mutation entirely — nothing changes, nothing queues', () => {
    seed()
    useStore.getState().setReadOnly(true)
    const before = useStore.getState().data

    useStore.getState().removeItem('projects', 'p1')
    useStore.getState().addItem('projects', makeProject({ id: 'p2' }))
    useStore.getState().updateItem('projects', 'p1', { customer: { en: 'Nope' } })

    const after = useStore.getState()
    expect(after.data).toBe(before)
    // mutationCount is what auto-save and the outbound queue key off, so a
    // refused edit must leave it exactly where it was.
    expect(after.mutationCount).toBe(0)
  })

  it('still lets the reader switch which two languages are on screen', () => {
    seed()
    useStore.getState().setReadOnly(true)

    useStore.getState().setPrimaryLocale('no')
    useStore.getState().setSecondaryLocale('en')

    expect(useStore.getState().primaryLocale).toBe('no')
    expect(useStore.getState().secondaryLocale).toBe('en')
    // A viewing choice, not an edit: it must not look like one to auto-save.
    expect(useStore.getState().mutationCount).toBe(0)
  })

  it('clears on unload so the next resume opened is not silently locked', () => {
    seed()
    useStore.getState().setReadOnly(true)
    useStore.getState().unloadStore()
    expect(useStore.getState().readOnly).toBe(false)
  })
})

describe('<ReadOnlyNotice>', () => {
  it('renders nothing on a resume you own', () => {
    const { container } = render(<ReadOnlyNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains why the editor accepts nothing, and cannot be dismissed', () => {
    useStore.getState().setReadOnly(true)
    render(<ReadOnlyNotice />)
    expect(screen.getByRole('status')).toHaveTextContent(/read only/i)
    expect(screen.getByText(/nothing you change here is\s+saved/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('<RichField> under readOnly', () => {
  const field = () => render(
    <RichField label="Description" value={{ en: '<p>Ran the migration.</p>' }} onChange={vi.fn()} />,
  )

  it('gives up its editability rather than letting text sit unsaved', () => {
    // It owns its own innerHTML, so a refused commit would leave typed text on
    // screen until a blur snapped it back — the one input the store block alone
    // does not make honest.
    useStore.getState().setReadOnly(true)
    field()
    const box = screen.getAllByRole('textbox')[0]
    expect(box).toHaveAttribute('contenteditable', 'false')
    expect(box).toHaveAttribute('aria-readonly', 'true')
    expect(screen.queryByRole('button', { name: /bold/i })).not.toBeInTheDocument()
  })

  it('is a normal editor on a resume you own', () => {
    field()
    expect(screen.getAllByRole('textbox')[0]).toHaveAttribute('contenteditable', 'true')
    expect(screen.getAllByRole('button', { name: /bold/i }).length).toBeGreaterThan(0)
  })
})

describe('<AppHeader> under readOnly', () => {
  const header = () => render(
    <AppHeader
      resumeId="r1"
      section={{ key: 'projects', label: 'Projects', group: 'experience', icon: 'Briefcase' }}
      saveState="idle"
      cacheSavedAt={null}
      onRetry={vi.fn()}
      onUnauthorized={vi.fn()}
    />,
  )

  it('hides the controls that only make sense as writes', () => {
    useStore.getState().setReadOnly(true)
    header()
    expect(screen.getByText(/read only/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^undo$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^redo$/i })).not.toBeInTheDocument()
    // Restoring a snapshot is a write too, and would be refused in silence.
    expect(screen.queryByRole('button', { name: /version history/i })).not.toBeInTheDocument()
  })

  it('keeps them on a resume you own', () => {
    header()
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /version history/i })).toBeInTheDocument()
  })
})
