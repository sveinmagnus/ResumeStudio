/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsModal } from '../../src/components/SettingsModal'
import { api, type SettingsStatus } from '../../src/lib/api'
import { useStore } from '../../src/store/useStore'
import { resetStore } from '../helpers/store-reset'
import { emptyStore, makeResume } from '../fixtures'
import * as backup from '../../src/lib/backup'

const managedStatus = (over: Partial<SettingsStatus['settings']> = {}): SettingsStatus => ({
  managed: true,
  settings: {
    translate_provider: 'off',
    libretranslate_url: '',
    libretranslate_api_key_set: false,
    translate_docker: false,
    deepl_api_key_set: false,
    google_api_key_set: false,
    azure_api_key_set: false,
    azure_region: '',
    backup_dir: '',
    backup_interval_ms: 60000,
    summarize_provider: 'off',
    summarize_ollama_url: '',
    summarize_docker: false,
    summarize_openai_api_key_set: false,
    summarize_compat_url: '',
    summarize_compat_api_key_set: false,
    summarize_model: '',
    ...over,
  },
  translate: { configured: false },
  summarize: { configured: false },
})

describe('<SettingsModal>', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows a read-only note when settings are env-managed (server build)', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({
      managed: false,
      settings: managedStatus().settings,
      translate: { configured: true },
    })
    render(<SettingsModal onClose={() => {}} onChanged={() => {}} onUnauthorized={() => {}} />)
    expect(await screen.findByText(/controlled by the server's environment/i)).toBeInTheDocument()
  })

  it('offers every provider in the dropdown + the backup folder', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(managedStatus())
    render(<SettingsModal onClose={() => {}} onChanged={() => {}} onUnauthorized={() => {}} />)
    const select = await screen.findByLabelText(/Translation provider/i)
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(labels).toEqual(expect.arrayContaining([
      expect.stringMatching(/Off/),
      expect.stringMatching(/DeepL/),
      expect.stringMatching(/Google/),
      expect.stringMatching(/Azure/),
      expect.stringMatching(/local \(Docker/i),
      expect.stringMatching(/remote URL/i),
    ]))
    expect(screen.getByLabelText(/Backup folder/i)).toBeInTheDocument()
    // The "Save to file" action moved here from the top bar, beside the folder.
    expect(screen.getByRole('button', { name: /save to file/i })).toBeInTheDocument()
  })

  it('downloads a portable backup from "Save to file"', async () => {
    resetStore()
    useStore.setState({ data: { ...emptyStore(), resume: makeResume() }, hasData: true })
    vi.spyOn(api, 'getSettings').mockResolvedValue(managedStatus())
    const spy = vi.spyOn(backup, 'downloadBackup').mockImplementation(() => {})
    render(<SettingsModal onClose={() => {}} onChanged={() => {}} onUnauthorized={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /save to file/i }))
    expect(spy).toHaveBeenCalledOnce()
  })

  it('saves a DeepL key', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(managedStatus())
    const saveSpy = vi.spyOn(api, 'saveSettings').mockResolvedValue(managedStatus({ translate_provider: 'deepl', deepl_api_key_set: true }))
    const onChanged = vi.fn()
    render(<SettingsModal onClose={() => {}} onChanged={onChanged} onUnauthorized={() => {}} />)

    await userEvent.selectOptions(await screen.findByLabelText(/Translation provider/i), 'deepl')
    fireEvent.change(screen.getByLabelText(/DeepL API key/i), { target: { value: 'my-deepl-key:fx' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => expect(saveSpy).toHaveBeenCalled())
    expect(saveSpy.mock.calls[0][0]).toMatchObject({ translate_provider: 'deepl', deepl_api_key: 'my-deepl-key:fx' })
    expect(onChanged).toHaveBeenCalled()
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('saves Azure with key + region', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(managedStatus())
    const saveSpy = vi.spyOn(api, 'saveSettings').mockResolvedValue(managedStatus({ translate_provider: 'azure', azure_api_key_set: true, azure_region: 'westeurope' }))
    render(<SettingsModal onClose={() => {}} onChanged={() => {}} onUnauthorized={() => {}} />)

    await userEvent.selectOptions(await screen.findByLabelText(/Translation provider/i), 'azure')
    fireEvent.change(screen.getByLabelText(/Azure API key/i), { target: { value: 'akey' } })
    fireEvent.change(screen.getByLabelText(/Azure region/i), { target: { value: 'westeurope' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => expect(saveSpy).toHaveBeenCalled())
    expect(saveSpy.mock.calls[0][0]).toMatchObject({ translate_provider: 'azure', azure_api_key: 'akey', azure_region: 'westeurope' })
  })

  it('saves a remote LibreTranslate URL', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(managedStatus())
    const saveSpy = vi.spyOn(api, 'saveSettings').mockResolvedValue(managedStatus({ translate_provider: 'libretranslate', libretranslate_url: 'https://lt.example.com' }))
    render(<SettingsModal onClose={() => {}} onChanged={() => {}} onUnauthorized={() => {}} />)

    await userEvent.selectOptions(await screen.findByLabelText(/Translation provider/i), 'libre_remote')
    fireEvent.change(screen.getByLabelText(/LibreTranslate URL/i), { target: { value: 'https://lt.example.com' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => expect(saveSpy).toHaveBeenCalled())
    expect(saveSpy.mock.calls[0][0]).toMatchObject({
      translate_provider: 'libretranslate', translate_docker: false, libretranslate_url: 'https://lt.example.com',
    })
  })

  it('shows Docker controls for the local LibreTranslate option', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(managedStatus())
    const dockerSpy = vi.spyOn(api, 'translateDocker').mockResolvedValue({ ok: true, available: true, message: 'started' })
    render(<SettingsModal onClose={() => {}} onChanged={() => {}} onUnauthorized={() => {}} />)

    await userEvent.selectOptions(await screen.findByLabelText(/Translation provider/i), 'libre_docker')
    await userEvent.click(await screen.findByRole('button', { name: /^Start$/i }))

    await waitFor(() => expect(dockerSpy).toHaveBeenCalledWith('start'))
    expect(await screen.findByText('started')).toBeInTheDocument()
  })

  it('tests the connection using the pending form values', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(managedStatus())
    const testSpy = vi.spyOn(api, 'testTranslate').mockResolvedValue({ reachable: true, message: 'Working — "Hello" → "Hei"' })
    render(<SettingsModal onClose={() => {}} onChanged={() => {}} onUnauthorized={() => {}} />)

    await userEvent.selectOptions(await screen.findByLabelText(/Translation provider/i), 'deepl')
    fireEvent.change(screen.getByLabelText(/DeepL API key/i), { target: { value: 'k:fx' } })
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }))

    await waitFor(() => expect(testSpy).toHaveBeenCalled())
    expect(testSpy.mock.calls[0][0]).toMatchObject({ translate_provider: 'deepl', deepl_api_key: 'k:fx' })
    expect(await screen.findByText(/Working/)).toBeInTheDocument()
  })
})
