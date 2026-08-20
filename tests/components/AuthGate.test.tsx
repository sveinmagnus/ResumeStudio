/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthGate } from '../../src/components/AuthGate'
import { ServerError, UnauthorizedError, api, type AuthStatus } from '../../src/lib/api'
import { savePending, loadPending } from '../../src/lib/localCache'
import { resolveConfirm, confirmDialogVisible } from '../helpers/confirm'
import { emptyStore } from '../fixtures'

const pending = (id: string, dirty = true) =>
  savePending(id, { data: emptyStore(), locales: { primary: 'en', secondary: null }, base_version: 1, dirty })

const status = (over: Partial<AuthStatus> = {}): AuthStatus => ({
  mode: 'accounts', auth_required: true, bootstrap_available: false, ...over,
})

/** Put the gate in one of its three modes and wait for it to settle. */
function mount(s: AuthStatus, onAuthenticated = vi.fn()) {
  vi.spyOn(api, 'authStatus').mockResolvedValue(s)
  render(<AuthGate onAuthenticated={onAuthenticated} />)
  return onAuthenticated
}

describe('<AuthGate>', () => {
  afterEach(() => { sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks() })

  describe('accounts mode', () => {
    it('takes one identifier for BOTH a username and an email address', async () => {
      mount(status())
      // One field, labelled for either — the server accepts either and does not
      // say which one matched.
      expect(await screen.findByLabelText(/username or email address/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    })

    it('signs in and tells the app a session exists', async () => {
      const login = vi.spyOn(api, 'loginWithPassword').mockResolvedValue(null)
      const onAuthenticated = mount(status())

      await userEvent.type(await screen.findByLabelText(/username or email/i), 'kari')
      await userEvent.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
      await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

      await waitFor(() => expect(login).toHaveBeenCalledWith('kari', 'correct-horse-battery'))
      expect(onAuthenticated).toHaveBeenCalled()
    })

    it("shows the server's refusal verbatim — it must not become more specific", async () => {
      vi.spyOn(api, 'loginWithPassword')
        .mockRejectedValue(new ServerError(401, 'Wrong username or password.'))
      mount(status())

      await userEvent.type(await screen.findByLabelText(/username or email/i), 'kari')
      await userEvent.type(screen.getByLabelText(/^password$/i), 'nope')
      await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Wrong username or password.')
    })

    it('hides "Forgotten password?" when the server cannot send mail', async () => {
      mount(status({ mail_configured: false }))
      await screen.findByLabelText(/username or email/i)
      expect(screen.queryByRole('link', { name: /forgotten password/i })).not.toBeInTheDocument()
      // The code path that needs no mail at all is always offered.
      expect(screen.getByRole('link', { name: /recovery code/i })).toBeInTheDocument()
    })

    it('offers it when mail is configured', async () => {
      mount(status({ mail_configured: true }))
      expect(await screen.findByRole('link', { name: /forgotten password/i }))
        .toHaveAttribute('href', '/forgot')
    })
  })

  describe('legacy token mode', () => {
    it('asks for the token instead of a password', async () => {
      mount(status({ mode: 'token' }))
      expect(await screen.findByPlaceholderText(/paste token/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /connect/i })).toBeDisabled()
    })

    it('reports a wrong token distinctly from an unreachable server', async () => {
      vi.spyOn(api, 'login').mockRejectedValue(new UnauthorizedError())
      mount(status({ mode: 'token' }))
      await userEvent.type(await screen.findByPlaceholderText(/paste token/i), 'bad')
      await userEvent.click(screen.getByRole('button', { name: /connect/i }))
      expect(await screen.findByText(/token is incorrect/i)).toBeInTheDocument()
    })
  })

  describe('first run', () => {
    const RESULT = {
      user: { id: 'u1', username: 'kari', display_name: 'Kari', role: 'owner' as const },
      claimed_resumes: 3,
      recovery_codes: ['AAAAA-BBBBB-CCCCC-DDDDD', 'EEEEE-FFFFF-GGGGG-HHHHH'],
      converted_tokens: ['ci-runner'],
    }

    const setup = async () => {
      const bootstrap = vi.spyOn(api, 'bootstrap').mockResolvedValue(RESULT)
      const onAuthenticated = mount(status({ mode: 'token', bootstrap_available: true }))
      await userEvent.type(await screen.findByLabelText(/one-time setup code/i), 'CODE-123')
      await userEvent.type(screen.getByLabelText(/^username$/i), 'kari')
      await userEvent.type(screen.getByLabelText(/display name/i), 'Kari Nordmann')
      await userEvent.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
      await userEvent.click(screen.getByRole('button', { name: /create the owner account/i }))
      return { bootstrap, onAuthenticated }
    }

    it('prefers the setup form over the sign-in form when a code is waiting', async () => {
      mount(status({ mode: 'token', bootstrap_available: true }))
      expect(await screen.findByLabelText(/one-time setup code/i)).toBeInTheDocument()
      expect(screen.queryByPlaceholderText(/paste token/i)).not.toBeInTheDocument()
    })

    it('shows the recovery codes once and will not continue until they are acknowledged', async () => {
      const { onAuthenticated } = await setup()

      expect(await screen.findByText('AAAAA-BBBBB-CCCCC-DDDDD')).toBeInTheDocument()
      expect(screen.getByText('EEEEE-FFFFF-GGGGG-HHHHH')).toBeInTheDocument()
      // The codes are stored hashed — this screen is the only time they exist
      // in readable form, so leaving it is gated on saying so.
      const cont = screen.getByRole('button', { name: /continue/i })
      expect(cont).toBeDisabled()
      expect(onAuthenticated).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('checkbox', { name: /saved these codes/i }))
      await userEvent.click(cont)
      expect(onAuthenticated).toHaveBeenCalled()
    })

    it('names the legacy tokens that became accounts and need reset links', async () => {
      await setup()
      expect(await screen.findByText('ci-runner')).toBeInTheDocument()
      expect(screen.getByText(/issue each of them a reset link/i)).toBeInTheDocument()
    })

    it('reports how many existing resumes the new owner just claimed', async () => {
      await setup()
      expect(await screen.findByText(/3 existing resumes now belong to your account/i))
        .toBeInTheDocument()
    })
  })

  // Security skill: explicit logout must clear the server session cookie AND
  // wipe the local plaintext resume caches, so a shared machine doesn't retain
  // the CV. (The credential lives only in an HttpOnly cookie, so there is
  // nothing JS-readable to assert — we assert the logout call + the cache wipe.)
  describe('clear local data', () => {
    it('logs out + wipes caches with no prompt when nothing is unsynced', async () => {
      const logoutSpy = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
      pending('r1', false)
      pending('r2', false)

      mount(status())
      await userEvent.click(await screen.findByRole('button', { name: /clear local data/i }))

      await waitFor(() => expect(logoutSpy).toHaveBeenCalledOnce())
      expect(confirmDialogVisible()).toBe(false)
      expect(loadPending('r1')).toBeNull()
      expect(loadPending('r2')).toBeNull()
    })

    it('prompts before wiping when there are unsynced changes, and clears on confirm', async () => {
      const logoutSpy = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
      pending('r1', true)

      mount(status())
      await userEvent.click(await screen.findByRole('button', { name: /clear local data/i }))
      await resolveConfirm('confirm')

      await waitFor(() => expect(logoutSpy).toHaveBeenCalledOnce())
      expect(loadPending('r1')).toBeNull()
    })

    it('keeps the caches when the user cancels the unsynced-changes prompt', async () => {
      const logoutSpy = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
      pending('r1', true)

      mount(status())
      await userEvent.click(await screen.findByRole('button', { name: /clear local data/i }))
      await resolveConfirm('cancel')

      // Nothing discarded — unsynced work is preserved, no logout fired.
      expect(logoutSpy).not.toHaveBeenCalled()
      expect(loadPending('r1')).not.toBeNull()
    })
  })
})
