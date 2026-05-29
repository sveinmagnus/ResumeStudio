import type { ResumeStore, ResumeView, ViewSection, LocalizedString } from '../types'
import { SECTIONS } from './sections'
import { resolve, fmtRange, fmtDate } from './locales'

// ─── Section helpers ──────────────────────────────────────────────────────────

/** Build default ViewSection[] for a new view — all content sections enabled in master order. */
export function buildViewSections(): ViewSection[] {
  return SECTIONS
    .filter((s) => s.storeKey && s.key !== 'views')
    .map((s, i) => ({ key: s.key, enabled: true, sort_order: i }))
}

/** Reorder sections within a view, swapping the target up or down. */
export function reorderViewSections(sections: ViewSection[], key: string, dir: 'up' | 'down'): ViewSection[] {
  const sorted = [...sections].sort((a, b) => a.sort_order - b.sort_order)
  const idx = sorted.findIndex((s) => s.key === key)
  const swap = dir === 'up' ? idx - 1 : idx + 1
  if (idx === -1 || swap < 0 || swap >= sorted.length) return sections
  ;[sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]]
  return sorted.map((s, i) => ({ ...s, sort_order: i }))
}

// ─── Item display helpers ─────────────────────────────────────────────────────

type AnyItem = Record<string, unknown>

function ls(item: AnyItem, field: string, locale: string): string {
  return resolve(item[field] as LocalizedString | undefined, locale)
}

type YM = { year: number; month: number | null } | null

function range(item: AnyItem): string {
  return fmtRange(item.start as YM, item.end as YM)
}

export function getItemTitle(sectionKey: string, item: unknown, locale: string): string {
  const it = item as AnyItem
  switch (sectionKey) {
    case 'projects':           return ls(it, 'customer', locale) || ls(it, 'description', locale) || 'Untitled project'
    case 'key_qualifications': return ls(it, 'label', locale) || 'Untitled profile'
    case 'work_experiences':   return ls(it, 'employer', locale) || 'Untitled employer'
    case 'educations':         return ls(it, 'school', locale) || 'Untitled school'
    case 'courses':            return ls(it, 'name', locale) || 'Untitled'
    case 'certifications':     return ls(it, 'name', locale) || 'Untitled'
    case 'positions':          return ls(it, 'name', locale) || 'Untitled'
    case 'presentations':      return ls(it, 'title', locale) || 'Untitled'
    case 'honor_awards':       return ls(it, 'name', locale) || 'Untitled'
    case 'publications':       return ls(it, 'title', locale) || 'Untitled'
    case 'technology_categories': return ls(it, 'name', locale) || 'Untitled'
    case 'spoken_languages':   return ls(it, 'name', locale) || 'Untitled'
    case 'references':         return (it.name as string) || 'Unnamed'
    case 'skills':             return ls(it, 'name', locale) || 'Unnamed skill'
    case 'roles':              return ls(it, 'name', locale) || 'Unnamed role'
    default:                   return String(it.id || 'Item')
  }
}

export function getItemSubtitle(sectionKey: string, item: unknown, locale: string): string {
  const it = item as AnyItem
  switch (sectionKey) {
    case 'projects':         return range(it)
    case 'work_experiences': return `${ls(it, 'role_title', locale)}${range(it) ? ' · ' + range(it) : ''}`
    case 'educations':       return `${ls(it, 'degree', locale)}${range(it) ? ' · ' + range(it) : ''}`
    case 'positions':        return `${ls(it, 'organisation', locale)}${range(it) ? ' · ' + range(it) : ''}`
    case 'presentations':    return ls(it, 'event', locale)
    case 'publications':     return ls(it, 'publisher', locale)
    case 'certifications':   return ls(it, 'organiser', locale)
    case 'courses':          return ls(it, 'program', locale)
    default:                 return ''
  }
}

// ─── View filter ──────────────────────────────────────────────────────────────

/** Return a filtered copy of the store with only the items/sections enabled in the view. */
export function applyView(store: ResumeStore, view: ResumeView): ResumeStore {
  const excluded = new Set(view.excluded_item_ids)
  const filtered = { ...store }

  for (const sec of SECTIONS) {
    if (!sec.storeKey || sec.key === 'views') continue
    const viewSec = view.sections.find((s) => s.key === sec.key)
    const enabled = viewSec ? viewSec.enabled : true
    const items = store[sec.storeKey] as Array<{ id: string; disabled?: boolean; starred?: boolean }>

    if (!enabled) {
      ;(filtered as Record<string, unknown>)[sec.storeKey] = []
    } else {
      ;(filtered as Record<string, unknown>)[sec.storeKey] = items.filter((item) => {
        if (item.disabled) return false
        if (excluded.has(item.id)) return false
        if (view.starred_only && !item.starred) return false
        return true
      })
    }
  }

  return filtered
}

// ─── HTML export ─────────────────────────────────────────────────────────────

function renderItem(sectionKey: string, item: unknown, locale: string): string {
  const it = item as AnyItem
  const l = (field: string) => ls(it, field, locale)
  const r = range(it)
  const meta = (parts: string[]) => parts.filter(Boolean).join(' · ')

  switch (sectionKey) {
    case 'projects': {
      const roleNames = (it.roles as Array<{ name: LocalizedString; disabled?: boolean }> ?? [])
        .filter((role) => !role.disabled)
        .map((role) => resolve(role.name, locale))
        .filter(Boolean)
      const skills = (it.skills as Array<{ name: LocalizedString }> ?? [])
        .map((s) => `<span class="ve-tag">${resolve(s.name, locale)}</span>`)
        .join('')
      return `<div class="ve-item">
        <h3>${l('customer')}</h3>
        <div class="ve-meta">${meta([r, l('industry'), roleNames.join(', ')])}</div>
        <div class="ve-desc">${l('long_description') || l('description')}</div>
        ${skills ? `<div class="ve-tags">${skills}</div>` : ''}
      </div>`
    }
    case 'key_qualifications': {
      const points = (it.key_points as Array<{ name: LocalizedString; long_description: LocalizedString }> ?? [])
        .map((p) => `<li><strong>${resolve(p.name, locale)}</strong>: ${resolve(p.long_description, locale)}</li>`)
        .join('')
      return `<div class="ve-item">
        <h3>${l('label')}</h3>
        <div class="ve-desc">${l('summary')}</div>
        ${points ? `<ul class="ve-points">${points}</ul>` : ''}
      </div>`
    }
    case 'work_experiences':
      return `<div class="ve-item">
        <h3>${l('employer')}</h3>
        <div class="ve-meta">${meta([l('role_title'), r])}</div>
        <div class="ve-desc">${l('long_description') || l('description')}</div>
      </div>`
    case 'educations':
      return `<div class="ve-item">
        <h3>${l('school')}</h3>
        <div class="ve-meta">${meta([l('degree'), r])}</div>
        <div class="ve-desc">${l('description')}</div>
      </div>`
    case 'courses':
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-meta">${meta([l('program')])}</div>
        <div class="ve-desc">${l('description')}</div>
      </div>`
    case 'certifications':
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-meta">${meta([l('organiser'), fmtDate(it.issued as YM)])}</div>
        <div class="ve-desc">${l('description')}</div>
      </div>`
    case 'positions':
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-meta">${meta([l('organisation'), r])}</div>
        <div class="ve-desc">${l('description')}</div>
      </div>`
    case 'spoken_languages':
      return `<div class="ve-item ve-inline"><strong>${l('name')}</strong> — ${l('level')}</div>`
    case 'technology_categories': {
      const skills = (it.skills as Array<{ name: LocalizedString }> ?? [])
        .map((s) => `<span class="ve-tag">${resolve(s.name, locale)}</span>`)
        .join('')
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-tags">${skills}</div>
      </div>`
    }
    case 'presentations':
      return `<div class="ve-item">
        <h3>${l('title')}</h3>
        <div class="ve-meta">${meta([l('event')])}</div>
        <div class="ve-desc">${l('description')}</div>
      </div>`
    case 'honor_awards':
      return `<div class="ve-item">
        <h3>${l('name')}</h3>
        <div class="ve-meta">${meta([l('issuer')])}</div>
        <div class="ve-desc">${l('description')}</div>
      </div>`
    case 'publications':
      return `<div class="ve-item">
        <h3>${l('title')}</h3>
        <div class="ve-meta">${meta([l('publisher')])}</div>
        <div class="ve-desc">${l('abstract')}</div>
      </div>`
    case 'references':
      if (!it.include_in_exports) return ''
      return `<div class="ve-item">
        <h3>${it.name as string}</h3>
        <div class="ve-meta">${meta([it.title as string, it.company as string])}</div>
      </div>`
    default:
      return ''
  }
}

export function buildViewHtml(store: ResumeStore, view: ResumeView, locale: string): string {
  const r = store.resume
  if (!r) return '<p>No resume data</p>'

  const filtered = applyView(store, view)
  const l = (ls_: LocalizedString | undefined) => resolve(ls_, locale)

  const contentSections = SECTIONS.filter((s) => s.storeKey && s.key !== 'views')

  const enabledSections = contentSections
    .map((s) => {
      const vs = view.sections.find((v) => v.key === s.key)
      return { ...s, sort_order: vs?.sort_order ?? 999, enabled: vs?.enabled ?? true }
    })
    .filter((s) => s.enabled)
    .sort((a, b) => a.sort_order - b.sort_order)

  const sectionsHtml = enabledSections
    .map((s) => {
      if (!s.storeKey) return ''
      const items = (filtered[s.storeKey] as unknown[])
      if (!items.length) return ''
      const itemsHtml = items.map((item) => renderItem(s.key, item, locale)).filter(Boolean).join('\n')
      if (!itemsHtml) return ''
      return `<section class="ve-section">
  <h2>${s.label}</h2>
  ${itemsHtml}
</section>`
    })
    .filter(Boolean)
    .join('\n')

  const intro = l(view.introduction)
  const contact = [r.email, r.phone, r.linkedin_url].filter(Boolean).join('  ·  ')

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <title>${view.name} — ${r.full_name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans+Condensed:wght@300&family=Ubuntu:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Ubuntu, sans-serif; font-size: 11pt; color: #111111; line-height: 1.55;
           padding: 32px 48px; max-width: 820px; margin: 0 auto; }
    h1  { font-family: 'Open Sans Condensed', sans-serif; font-weight: 300; font-size: 30pt;
           color: #002E6E; margin-bottom: 4px; }
    h2  { font-family: 'Open Sans Condensed', sans-serif; font-weight: 300; font-size: 15pt;
           color: #002E6E; border-bottom: 1.5px solid #d1d8e8; padding-bottom: 5px;
           margin: 28px 0 14px; }
    h3  { font-size: 11pt; font-weight: 600; color: #002E6E; margin-bottom: 3px; }
    .ve-header-title  { font-size: 12pt; color: #374151; margin: 3px 0 8px; }
    .ve-header-contact { font-size: 9pt; color: #6B7280; }
    .ve-intro { background: #f0f4f8; border-left: 3px solid #002E6E;
                padding: 12px 18px; margin: 20px 0; font-size: 10.5pt; white-space: pre-line; }
    .ve-section { margin-bottom: 8px; }
    .ve-item { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid #e8ecf5; }
    .ve-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .ve-inline { display: inline-block; margin-right: 20px; }
    .ve-meta { font-size: 9pt; color: #6B7280; margin: 2px 0 5px; }
    .ve-desc { font-size: 10pt; color: #374151; margin-top: 5px; }
    .ve-points { margin: 8px 0 0 18px; font-size: 10pt; color: #374151; }
    .ve-points li { margin-bottom: 3px; }
    .ve-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
    .ve-tag { background: #e6ecf8; color: #002E6E; font-size: 8.5pt;
              padding: 2px 8px; border-radius: 10px; }
    @media print {
      body { padding: 0; }
      .ve-item { break-inside: avoid; }
      h2 { break-before: auto; }
    }
  </style>
</head>
<body>
  <div class="ve-header">
    <h1>${r.full_name}</h1>
    <div class="ve-header-title">${l(r.title)}</div>
    ${contact ? `<div class="ve-header-contact">${contact}</div>` : ''}
  </div>

  ${intro ? `<div class="ve-intro">${intro}</div>` : ''}

  ${sectionsHtml}
</body>
</html>`
}
