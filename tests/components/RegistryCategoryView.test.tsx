/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { dropTargetCategory } from '../../src/components/editor/RegistryCategoryView'

describe('dropTargetCategory', () => {
  it('maps a header drop (plain key) to that category', () => {
    expect(dropTargetCategory('Cloud & Infrastructure')).toBe('Cloud & Infrastructure')
  })

  it('maps a quick-panel drop (PANEL-prefixed) to the same category', () => {
    expect(dropTargetCategory('panel:Cloud & Infrastructure')).toBe('Cloud & Infrastructure')
  })

  it('maps the Uncategorized sentinel (header or panel) to null', () => {
    expect(dropTargetCategory('__uncategorized__')).toBeNull()
    expect(dropTargetCategory('panel:__uncategorized__')).toBeNull()
  })
})
