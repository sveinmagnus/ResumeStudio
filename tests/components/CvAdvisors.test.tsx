/**
 * @vitest-environment jsdom
 *
 * The LOCKED state of the advisors block — what someone sees before any model
 * is configured, which for most people is the only version of this block they
 * ever read. It has to explain what an advisor IS, not just list five of them
 * by nickname.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CvAdvisors } from '../../src/components/editor/CvAdvisors'
import { resetStore } from '../helpers/store-reset'
import { resetLlmAvailability } from '../../src/lib/llmClient'
import { api } from '../../src/lib/api'

const OFF = { configured: false, provider: '', model: '', local: false }
const SMALL = { configured: true, provider: 'ollama', model: 'llama3.2:3b', local: true, high_end: false }

function backend(status: Record<string, unknown>) {
  resetLlmAvailability()
  vi.spyOn(api, 'llmStatus').mockResolvedValue(status as never)
}

describe('<CvAdvisors> — locked', () => {
  beforeEach(() => {
    resetStore()
    vi.restoreAllMocks()
  })

  it('says what an advisor is before naming any of them', async () => {
    backend(OFF)
    render(<CvAdvisors />)
    const lede = await screen.findByText(/reads your/i)
    // The distinction that makes the block make sense: one field vs the whole
    // document. Without it "these" referred to nothing on screen.
    expect(lede.textContent).toMatch(/each work on one field/i)
    expect(lede.textContent).toMatch(/whole CV in one pass/i)
  })

  it('names each advisor as its own card names it', async () => {
    backend(OFF)
    render(<CvAdvisors />)
    await screen.findByText(/reads your/i)
    for (const title of [
      'Review my whole CV',
      'Make the writing consistent',
      'Find buried achievements',
      'Do my two languages say the same thing?',
      'Can I answer this posting?',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
  })

  it('keeps the lede as ONE flex item beside the icon', async () => {
    // Regression: `.cva-locked-lede` is display:flex, so bare text around a
    // <strong> became separate anonymous flex items and the sentence rendered
    // as three side-by-side columns.
    backend(OFF)
    const { container } = render(<CvAdvisors />)
    await screen.findByText(/reads your/i)
    const lede = container.querySelector('.cva-locked-lede')!
    const children = Array.from(lede.childNodes)
    expect(children).toHaveLength(2)
    expect((children[0] as Element).tagName.toLowerCase()).toBe('svg')
    expect((children[1] as Element).tagName.toLowerCase()).toBe('span')
    // No loose text node can sneak back in beside them.
    expect(children.some((n) => n.nodeType === 3)).toBe(false)
  })

  it('explains the high-end gate when a small model is configured', async () => {
    backend(SMALL)
    render(<CvAdvisors />)
    await waitFor(() =>
      expect(screen.getByText(/isn’t marked\s+as high-end/i)).toBeInTheDocument())
    // Still teaches what the advisors are — the gate copy replaces only the
    // "why can't I use this" paragraph.
    expect(screen.getByText('Review my whole CV')).toBeInTheDocument()
  })
})
