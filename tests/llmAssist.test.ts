import { describe, it, expect } from 'vitest'
import {
  paramsOf, inputBudget, estimateTokens, sizeHint, providerBlurb, isRemote,
} from '../src/lib/llmAssist'
import type { AssistStatus } from '../src/lib/api'

const local = (model: string): AssistStatus =>
  ({ configured: true, provider: 'ollama', model, local: true })
const remote = (model: string, provider = 'openai'): AssistStatus =>
  ({ configured: true, provider, model, local: false })
const off: AssistStatus = { configured: false, provider: '', model: '', local: false }

describe('paramsOf()', () => {
  it('reads the parameter count out of an Ollama tag', () => {
    expect(paramsOf('llama3.2:3b')).toBe(3)
    expect(paramsOf('qwen2.5:0.5b')).toBe(0.5)
    expect(paramsOf('phi3.5:3.8b')).toBe(3.8)
    expect(paramsOf('llama3.1:8b')).toBe(8)
  })

  it('handles sub-billion m tags', () => {
    expect(paramsOf('smollm2:360m')).toBeCloseTo(0.36)
  })

  it('is null for names with no size in them', () => {
    expect(paramsOf('gpt-4o-mini')).toBeNull()
    expect(paramsOf('my-org/custom:latest')).toBeNull()
    expect(paramsOf('')).toBeNull()
  })
})

describe('inputBudget()', () => {
  it('gives small local models a small budget', () => {
    expect(inputBudget(local('llama3.2:3b'))).toBeLessThan(inputBudget(local('llama3.1:8b')))
  })

  it('assumes an unsized LOCAL model is small, and an unsized REMOTE one is large', () => {
    // The failure being guarded against (garbled output from an overloaded 3B)
    // is the local one; hosted endpoints are chosen for their big context.
    expect(inputBudget(local('custom:latest'))).toBeLessThan(inputBudget(remote('gpt-4o-mini')))
  })
})

describe('sizeHint()', () => {
  it('is silent for a prompt that fits', () => {
    expect(sizeHint(500, local('llama3.2:3b'))).toBeNull()
  })

  it('warns when a small local model would be overloaded', () => {
    const hint = sizeHint(200_000, local('llama3.2:3b'))
    expect(hint).toContain('llama3.2:3b')
    expect(hint).toMatch(/truncate or garble/i)
  })

  it('lets the same prompt through on a hosted model', () => {
    expect(sizeHint(60_000, remote('gpt-4o-mini'))).toBeNull()
  })

  it('says nothing when no model is configured (the manual path has no limit)', () => {
    expect(sizeHint(999_999, off)).toBeNull()
  })
})

describe('providerBlurb()', () => {
  it('promises locality ONLY for a local endpoint', () => {
    expect(providerBlurb(local('llama3.2:3b'))).toMatch(/does not leave/i)
  })

  it('names the destination for a remote endpoint, and never claims locality', () => {
    const b = providerBlurb(remote('gpt-4o-mini', 'openai'))
    expect(b).toMatch(/over the internet/i)
    expect(b).toContain('openai')
    expect(b).not.toMatch(/does not leave/i)
  })

  it('points at the manual path when nothing is configured', () => {
    expect(providerBlurb(off)).toMatch(/manual/i)
  })
})

describe('isRemote()', () => {
  it('is true only for a configured, non-local backend', () => {
    expect(isRemote(remote('gpt-4o-mini'))).toBe(true)
    expect(isRemote(local('llama3.2:3b'))).toBe(false)
    // Nothing configured sends nothing anywhere — no confirm to show.
    expect(isRemote(off)).toBe(false)
  })
})

describe('estimateTokens()', () => {
  it('scales with length', () => {
    expect(estimateTokens(3500)).toBe(1000)
    expect(estimateTokens(0)).toBe(0)
  })
})
