/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateBanner } from '../../src/components/UpdateBanner'
import { api, type UpdateStatus } from '../../src/lib/api'

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  supported: true,
  state: 'available',
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  updateAvailable: true,
  downloadable: true,
  progress: 0,
  lastCheckedAt: null,
  notes: '',
  htmlUrl: 'https://github.com/sveinmagnus/resumestudio/releases/tag/v0.2.0',
  error: null,
  ...over,
})

describe('<UpdateBanner>', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders nothing on a web/VPS build (unsupported)', async () => {
    vi.spyOn(api, 'updateStatus').mockResolvedValue(status({ supported: false }))
    const { container } = render(<UpdateBanner onUnauthorized={() => {}} />)
    await waitFor(() => expect(api.updateStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when already up to date', async () => {
    vi.spyOn(api, 'updateStatus').mockResolvedValue(status({ state: 'uptodate', updateAvailable: false, latestVersion: '0.1.0' }))
    const { container } = render(<UpdateBanner onUnauthorized={() => {}} />)
    await waitFor(() => expect(api.updateStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the available version + a Release notes link', async () => {
    vi.spyOn(api, 'updateStatus').mockResolvedValue(status())
    render(<UpdateBanner onUnauthorized={() => {}} />)
    expect(await screen.findByText(/v0\.2\.0 is available/i)).toBeInTheDocument()
    expect(screen.getByText(/You have v0\.1\.0/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /release notes/i })
    expect(link).toHaveAttribute('href', 'https://github.com/sveinmagnus/resumestudio/releases/tag/v0.2.0')
  })

  it('"Install update" calls the API', async () => {
    vi.spyOn(api, 'updateStatus').mockResolvedValue(status())
    const installSpy = vi.spyOn(api, 'installUpdate').mockResolvedValue(undefined)
    render(<UpdateBanner onUnauthorized={() => {}} />)
    const btn = await screen.findByRole('button', { name: /install update/i })
    await userEvent.click(btn)
    await waitFor(() => expect(installSpy).toHaveBeenCalled())
  })

  it('offers a GitHub download (no Install) when the update has no asset for this platform', async () => {
    vi.spyOn(api, 'updateStatus').mockResolvedValue(status({ downloadable: false }))
    render(<UpdateBanner onUnauthorized={() => {}} />)
    expect(await screen.findByText(/v0\.2\.0 is available/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /install update/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /download from github/i })).toBeInTheDocument()
  })

  it('shows download progress while installing', async () => {
    vi.spyOn(api, 'updateStatus').mockResolvedValue(status({ state: 'downloading', progress: 0.42 }))
    render(<UpdateBanner onUnauthorized={() => {}} />)
    expect(await screen.findByText(/Downloading update/i)).toBeInTheDocument()
    expect(screen.getByText(/42%/)).toBeInTheDocument()
  })
})
