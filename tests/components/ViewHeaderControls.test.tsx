/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewHeaderControls } from '../../src/components/editor/views/ViewHeaderControls'
import { DEFAULT_VIEW_HEADER, defaultHeaderFields } from '../../src/lib/viewHeader'
import * as imageLib from '../../src/lib/image'

const header = () => ({ ...DEFAULT_VIEW_HEADER, fields: defaultHeaderFields() })

function renderControls(over: Partial<Parameters<typeof ViewHeaderControls>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <ViewHeaderControls
      header={header()}
      primaryLocale="en"
      masterPhoto={null}
      masterLogo={null}
      profileImageUrl="https://cdn.example/pic.jpg"
      onChange={onChange}
      {...over}
    />,
  )
  return { onChange }
}

afterEach(() => vi.restoreAllMocks())

describe('<ViewHeaderControls> — use profile image URL', () => {
  it('imports the external URL into this view\'s photo_override on success', async () => {
    vi.spyOn(imageLib, 'imageUrlToResizedDataUrl').mockResolvedValue('data:image/jpeg;base64,ZZZ')
    const { onChange } = renderControls()

    await userEvent.click(screen.getByRole('button', { name: /use profile image url/i }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ photo_override: 'data:image/jpeg;base64,ZZZ' }))
    expect(imageLib.imageUrlToResizedDataUrl).toHaveBeenCalledWith('https://cdn.example/pic.jpg', expect.objectContaining({ format: 'jpeg' }))
  })

  it('surfaces an error (e.g. CORS) without changing the config', async () => {
    vi.spyOn(imageLib, 'imageUrlToResizedDataUrl').mockRejectedValue(new Error('blocked by CORS'))
    const { onChange } = renderControls()

    await userEvent.click(screen.getByRole('button', { name: /use profile image url/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/CORS/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not offer the button when the resume has no profile image URL', () => {
    renderControls({ profileImageUrl: null })
    expect(screen.queryByRole('button', { name: /use profile image url/i })).not.toBeInTheDocument()
  })
})
