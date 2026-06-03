import { describe, it, expect } from 'vitest'
import { decideBoot, selectDrainTargets, type BootInput, type BootAction } from '../src/lib/syncEngine'

describe('decideBoot', () => {
  const cases: Array<[string, BootInput, BootAction['kind']]> = [
    ['server hit + dirty local → flush-local',
      { server: 'hit', pending: { dirty: true } }, 'flush-local'],
    ['server hit + clean local → load-server',
      { server: 'hit', pending: { dirty: false } }, 'load-server'],
    ['server hit + no local → load-server',
      { server: 'hit', pending: null }, 'load-server'],
    ['server 404 → not-found (no cache fallback for ghosts)',
      { server: 'not-found', pending: { dirty: true } }, 'not-found'],
    ['server 404 + no local → not-found',
      { server: 'not-found', pending: null }, 'not-found'],
    ['unreachable + dirty local → offline-local',
      { server: 'unreachable', pending: { dirty: true } }, 'offline-local'],
    ['unreachable + clean local → offline-local',
      { server: 'unreachable', pending: { dirty: false } }, 'offline-local'],
    ['unreachable + no local → not-found',
      { server: 'unreachable', pending: null }, 'not-found'],
  ]

  it.each(cases)('%s', (_label, input, expected) => {
    expect(decideBoot(input).kind).toBe(expected)
  })
})

describe('selectDrainTargets', () => {
  it('splits the active resume from the background set', () => {
    expect(selectDrainTargets(['a', 'b', 'c'], 'b')).toEqual({
      active: true,
      background: ['a', 'c'],
    })
  })

  it('marks active false when the active id is not dirty', () => {
    expect(selectDrainTargets(['a', 'c'], 'b')).toEqual({
      active: false,
      background: ['a', 'c'],
    })
  })

  it('handles an empty dirty set', () => {
    expect(selectDrainTargets([], 'b')).toEqual({ active: false, background: [] })
  })

  it('handles only-the-active-resume-dirty', () => {
    expect(selectDrainTargets(['b'], 'b')).toEqual({ active: true, background: [] })
  })
})
