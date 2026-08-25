import { useMemo, useState, type ReactNode } from 'react'
import { X, Flag, ArrowRight, Trash2, BookOpen } from 'lucide-react'
import { useStore } from '../../../store/useStore'
import { useDialog } from '../../ui/useDialog'
import { applyView, viewProfileTagLine } from '../../../lib/viewFilter'
import { planViewSections, sectionItems, renderKeyFor } from '../../../lib/viewSectionPlan'
import { SECTION_CATALOG, isEmptyItemView, type AnyItem, type CatalogCtx, type ItemView } from '../../../lib/sectionCatalog'
import { summarySegments, fullItemLayout } from '../../../lib/itemLayout'
import { skillMatrixRows, fmtProficiency } from '../../../lib/skillMatrix'
import { localizedSectionHeading } from '../../../lib/sections'
import { withDefaults, resolveSectionStyle, sectionHeadingText, kqVisibility } from '../../../lib/viewStyle'
import { parseRichBlocks, plainParagraphs, type RichBlock, type RichRun } from '../../../lib/richText'
import { resolve } from '../../../lib/locales'
import {
  loadFlags, saveFlags, addFlag, removeFlag, updateFlagNote, findFlag, type ReadFlag,
} from '../../../lib/readThrough'
import type { LocalizedString, ResumeView } from '../../../types'

/**
 * Read-through mode: the view's content as ONE flowing document — what the PDF
 * says, minus the layout chrome — so the consultant can read their CV the way a
 * recruiter will, and capture reactions without switching into editing.
 *
 * A reaction is a FLAG on an item ("stale", "undersells it"), kept in
 * localStorage per view (lib/readThrough.ts) so leaving to fix the first one
 * doesn't lose the rest. This is editor chrome, not a fifth export target — the
 * render parity rules govern exports; this reuses the same catalog data views
 * so what it shows can't drift from what ships.
 */
export function ReadThroughMode({ view, locale, onClose }: {
  view: ResumeView
  locale: string
  onClose: () => void
}) {
  const { data, setActiveSection, setExpandedItem } = useStore()
  const dialogRef = useDialog(onClose)
  const resumeId = data.resume?.id ?? ''

  const [flags, setFlags] = useState<ReadFlag[]>(() => loadFlags(resumeId, view.id))
  const persist = (next: ReadFlag[]) => {
    setFlags(next)
    saveFlags(resumeId, view.id, next)
  }

  const toggleFlag = (section: string, itemId: string | null, label: string) => {
    const existing = findFlag(flags, section, itemId)
    persist(existing ? removeFlag(flags, existing.id) : addFlag(flags, { section, itemId, label }))
  }

  const openInEditor = (f: ReadFlag) => {
    if (f.itemId) {
      setActiveSection(f.section)
      setExpandedItem(f.itemId)
    }
    onClose()
  }

  const filtered = useMemo(() => applyView(data, view), [data, view])
  const viewStyle = withDefaults(view.style)
  const plan = planViewSections(view)

  const titleLine = resolve(view.header?.title_override as LocalizedString | undefined, locale)
    || viewProfileTagLine(data, view, locale)
    || resolve(data.resume?.title, locale)
  const introParas = plainParagraphs(resolve(view.introduction, locale))

  return (
    <div className="rt-backdrop" role="presentation">
      <div
        className="rt-shell" ref={dialogRef} role="dialog" aria-modal="true"
        aria-label={`Read through ${view.name}`}
      >
        <div className="rt-bar">
          <span className="rt-bar-title"><BookOpen size={15} /> Reading: {view.name}</span>
          <span className="rt-bar-hint">Flag anything that reads wrong — fix it afterwards.</span>
          <button className="rt-close" onClick={onClose} aria-label="Close reading mode">
            <X size={16} /> Done
          </button>
        </div>

        <div className="rt-columns">
          <div className="rt-doc" lang={locale}>
            <h1 className="rt-name">{data.resume?.full_name}</h1>
            {titleLine && <p className="rt-title">{titleLine}</p>}

            {introParas.length > 0 && (
              <FlagTarget
                flagged={!!findFlag(flags, 'views', view.id)}
                onFlag={() => toggleFlag('views', view.id, 'View introduction')}
                label="View introduction"
              >
                {introParas.map((p, i) => <p key={i} className="rt-para">{p}</p>)}
              </FlagTarget>
            )}

            {plan.map((s) => {
              if (!s.storeKey) return null
              const resolved = resolveSectionStyle(viewStyle, s.sectionStyle, renderKeyFor(s.key))
              const heading = resolved.hide_heading
                ? ''
                : sectionHeadingText(resolved, localizedSectionHeading(s.key, locale), locale)

              if (s.key === 'skill_matrix') {
                const rows = skillMatrixRows(data, view, locale, { highlightedOnly: s.detail === 'summary' })
                if (!rows.length) return null
                return (
                  <section key={s.key} className="rt-section">
                    {heading && <h2 className="rt-heading">{heading}</h2>}
                    {rows.map((row) => (
                      <p key={row.name} className="rt-line">
                        <strong>{row.name}</strong>
                        {/* Editor chrome, so English units — the localized form
                            is the exports' job (lib/exportStrings stays theirs). */}
                        <span className="rt-meta-inline"> — {row.years ? `${row.years} yr${row.years === 1 ? '' : 's'}` : '—'} · {fmtProficiency(row.proficiency)}</span>
                      </p>
                    ))}
                  </section>
                )
              }

              const items = sectionItems(data, view, filtered, s, locale)
              if (!items.length) return null
              const renderKey = renderKeyFor(s.key)
              const desc = SECTION_CATALOG[renderKey]
              if (!desc) return null
              const cctx: CatalogCtx = {
                locale, hideDates: !!resolved.hide_dates, dateFormat: resolved.date_format,
                target: 'html', extras: resolved.extras,
                kq: kqVisibility(resolved, s.detail === 'summary' ? 'summary' : 'full'),
              }

              const blocks = items.map((item, i) => {
                const flagSection = s.virtual ? (s.storeKey as string) : s.key
                const id = String((item as AnyItem).id ?? i)
                const label = desc.title(item as AnyItem, locale) || heading || s.key
                const flagged = !!findFlag(flags, flagSection, id)
                const flag = () => toggleFlag(flagSection, id, label)

                if (s.detail === 'summary' && !desc.alwaysFull) {
                  const sum = desc.summary?.(item as AnyItem, cctx)
                  if (!sum) return null
                  const segments = summarySegments(sum, resolved.summary_layout)
                  const short = resolve((item as AnyItem).short_description as LocalizedString | undefined, locale)
                  return (
                    <FlagTarget key={id} flagged={flagged} onFlag={flag} label={label}>
                      <p className="rt-line">
                        {segments.map((g, gi) => (
                          <span key={gi}>
                            {g.joiner}
                            {g.slot === 'title' ? <strong>{g.text}</strong> : <span className="rt-meta-inline">{g.text}</span>}
                          </span>
                        ))}
                        {short.trim() && <span className="rt-meta-inline"> — {short.trim()}</span>}
                      </p>
                    </FlagTarget>
                  )
                }

                const v = desc.full?.(item as AnyItem, cctx)
                if (!v || isEmptyItemView(v)) return null
                return (
                  <FlagTarget key={id} flagged={flagged} onFlag={flag} label={label}>
                    <FullItem v={v} datePosition={resolved.date_position} />
                  </FlagTarget>
                )
              }).filter(Boolean)

              if (!blocks.length) return null
              return (
                <section key={s.key} className="rt-section">
                  {heading && <h2 className="rt-heading">{heading}</h2>}
                  {blocks}
                </section>
              )
            })}
          </div>

          <aside className="rt-rail" aria-label="Flagged while reading">
            <div className="rt-rail-head">
              <Flag size={14} /> Flags <span className="rt-rail-count">{flags.length}</span>
            </div>
            {flags.length === 0 ? (
              <p className="rt-rail-empty">
                Nothing flagged yet. Click the flag beside anything that reads
                wrong — stale, underselling, repetitive — and deal with it after
                the read.
              </p>
            ) : (
              <ul className="rt-rail-list">
                {flags.map((f) => (
                  <li key={f.id} className="rt-rail-item">
                    <div className="rt-rail-item-head">
                      <span className="rt-rail-label">{f.label}</span>
                      <button
                        className="rt-rail-btn" onClick={() => persist(removeFlag(flags, f.id))}
                        title="Remove this flag" aria-label={`Remove the flag on ${f.label}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <input
                      className="rt-rail-note"
                      value={f.note}
                      placeholder="Why it reads wrong…"
                      onChange={(e) => persist(updateFlagNote(flags, f.id, e.target.value))}
                      aria-label={`Note for the flag on ${f.label}`}
                    />
                    {f.itemId && (
                      <button className="rt-rail-open" onClick={() => openInEditor(f)}>
                        Open in editor <ArrowRight size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
      <style>{`
        .rt-backdrop { position: fixed; inset: 0; background: var(--paper); z-index: 100; }
        .rt-shell { height: 100%; display: flex; flex-direction: column; }
        .rt-bar {
          display: flex; align-items: center; gap: 14px;
          padding: 10px 20px; border-bottom: 1px solid var(--line);
          background: var(--paper-raised); flex-shrink: 0;
        }
        .rt-bar-title { display: inline-flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13.5px; color: var(--accent); }
        .rt-bar-hint { font-size: 12.5px; color: var(--ink-faint); }
        .rt-close {
          margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 14px; font-size: 13px; font-weight: 600;
          border: 1px solid var(--line-strong); border-radius: var(--r-sm);
          color: var(--ink-soft); transition: color .12s, border-color .12s;
        }
        .rt-close:hover { color: var(--accent); border-color: var(--accent); }
        .rt-columns { flex: 1; display: flex; min-height: 0; }
        .rt-doc {
          flex: 1; overflow-y: auto; overscroll-behavior: contain;
          padding: 44px clamp(24px, 8vw, 96px) 80px;
          font-size: 15.5px; line-height: 1.7; color: var(--ink);
          max-width: 860px; margin: 0 auto;
        }
        .rt-name { font-size: 34px; margin-bottom: 2px; }
        .rt-title { color: var(--ink-soft); font-size: 16px; margin-bottom: 26px; }
        .rt-heading {
          font-size: 22px; color: var(--accent); margin: 34px 0 12px;
          border-bottom: 1.5px solid var(--secondary-line); padding-bottom: 5px;
        }
        .rt-section { margin-bottom: 8px; }
        .rt-para { margin-bottom: 0.6em; }
        .rt-line { margin-bottom: 4px; }
        .rt-item-title { font-size: 16.5px; font-weight: 600; margin-bottom: 1px; }
        .rt-meta { font-size: 13px; color: var(--ink-faint); margin-bottom: 6px; }
        .rt-meta-inline { color: var(--ink-soft); }
        .rt-points { margin: 6px 0 6px 22px; }
        .rt-points li { margin-bottom: 3px; }
        .rt-tags { font-size: 13px; color: var(--ink-faint); font-style: italic; margin-top: 4px; }
        .rt-extra { font-size: 13px; color: var(--ink-faint); margin-top: 2px; }
        .rt-quote { border-left: 3px solid var(--secondary-line); padding-left: 14px; font-style: italic; color: var(--ink-soft); }
        .rt-attrib { font-size: 13px; color: var(--ink-faint); margin-top: 4px; }

        /* Flag affordance: quiet gutter button that shows on hover/focus,
           stays visible once flagged. */
        .rt-flagwrap { position: relative; padding: 6px 0 10px; border-radius: var(--r-sm); }
        .rt-flagwrap:hover { background: var(--paper-raised); }
        .rt-flagbtn {
          position: absolute; top: 6px; right: 4px;
          width: 30px; height: 30px; display: grid; place-items: center;
          border-radius: var(--r-sm); color: var(--ink-faint);
          opacity: 0; transition: opacity .12s, color .12s, background .12s;
        }
        .rt-flagwrap:hover .rt-flagbtn, .rt-flagbtn:focus-visible { opacity: 1; }
        .rt-flagbtn:hover { background: var(--accent-wash); color: var(--accent); }
        .rt-flagbtn.rt-flagged { opacity: 1; color: var(--accent); }
        .rt-flagwrap.rt-has-flag { background: var(--accent-wash); }

        /* Flag rail */
        .rt-rail {
          width: 290px; flex-shrink: 0; border-left: 1px solid var(--line);
          background: var(--paper-raised); overflow-y: auto; overscroll-behavior: contain;
          padding: 18px 16px;
        }
        .rt-rail-head {
          display: flex; align-items: center; gap: 7px;
          font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
          color: var(--ink-soft); margin-bottom: 12px;
        }
        .rt-rail-count {
          font-size: 11px; background: var(--accent); color: #fff;
          border-radius: 9px; padding: 1px 7px; font-variant-numeric: tabular-nums;
        }
        .rt-rail-empty { font-size: 12.5px; color: var(--ink-faint); line-height: 1.55; }
        .rt-rail-list { list-style: none; display: flex; flex-direction: column; gap: 12px; }
        .rt-rail-item {
          padding: 9px 10px; background: var(--paper); border: 1px solid var(--line);
          border-radius: var(--r-sm);
        }
        .rt-rail-item-head { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
        .rt-rail-label { flex: 1; font-size: 13px; font-weight: 600; color: var(--ink); min-width: 0;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rt-rail-btn {
          width: 26px; height: 26px; display: grid; place-items: center; flex-shrink: 0;
          border-radius: var(--r-sm); color: var(--ink-faint); transition: color .12s, background .12s;
        }
        .rt-rail-btn:hover { background: var(--paper-sunken); color: var(--err-ink); }
        .rt-rail-note {
          width: 100%; padding: 5px 8px; font-size: 12.5px;
          border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper-sunken);
        }
        .rt-rail-note:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-wash); }
        .rt-rail-open {
          display: inline-flex; align-items: center; gap: 4px; margin-top: 6px;
          font-size: 12px; font-weight: 600; color: var(--accent);
          padding: 2px 6px; border-radius: var(--r-sm); transition: background .12s;
        }
        .rt-rail-open:hover { background: var(--accent-wash); }

        @media (max-width: 760px) {
          .rt-columns { flex-direction: column; }
          .rt-rail { width: auto; border-left: none; border-top: 1px solid var(--line); max-height: 40vh; }
        }
      `}</style>
    </div>
  )
}

/** One flaggable block: content + the gutter flag toggle. */
function FlagTarget({ flagged, onFlag, label, children }: {
  flagged: boolean
  onFlag: () => void
  label: string
  children: ReactNode
}) {
  return (
    <div className={`rt-flagwrap${flagged ? ' rt-has-flag' : ''}`}>
      {children}
      <button
        className={`rt-flagbtn${flagged ? ' rt-flagged' : ''}`}
        onClick={onFlag}
        title={flagged ? `Unflag ${label}` : `Flag ${label}`}
        aria-label={flagged ? `Unflag ${label}` : `Flag ${label} as reading wrong`}
        aria-pressed={flagged}
      >
        <Flag size={14} fill={flagged ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}

/** A full-detail item, rendered from the catalog's data view (no markup in descriptors). */
function FullItem({ v, datePosition }: { v: ItemView; datePosition: Parameters<typeof fullItemLayout>[1] }) {
  if (v.layout === 'inline') {
    const metaTxt = v.meta.filter(Boolean).join(' · ')
    return (
      <>
        <p className="rt-line">
          <strong>{v.title}</strong>
          {metaTxt && <span className="rt-meta-inline"> — {metaTxt}</span>}
        </p>
        {v.extraLines.filter(Boolean).map((l, i) => <p key={i} className="rt-extra">{l}</p>)}
      </>
    )
  }
  if (v.layout === 'quote') {
    const tail = v.attributionMeta.filter(Boolean).join(' · ')
    return (
      <>
        <div className="rt-quote"><RichBody html={v.body} /></div>
        <p className="rt-attrib">— {v.attribution}{tail ? ` · ${tail}` : ''}</p>
      </>
    )
  }
  const { metaParts, metaFirst } = fullItemLayout(v, datePosition)
  const metaTxt = metaParts.join(' · ')
  const head = (
    <>
      {metaFirst && metaTxt && <p className="rt-meta">{metaTxt}</p>}
      {v.title && <h3 className="rt-item-title">{v.title}</h3>}
      {!metaFirst && metaTxt && <p className="rt-meta">{metaTxt}</p>}
    </>
  )
  return (
    <>
      {head}
      {v.plainBody && <p className="rt-para">{v.plainBody}</p>}
      {v.body && <RichBody html={v.body} />}
      {v.points.length > 0 && (
        <ul className="rt-points">
          {v.points.map((p, i) => (
            <li key={i}>{p.label && <strong>{p.label}: </strong>}<RichInline html={p.body} /></li>
          ))}
        </ul>
      )}
      {v.tags.length > 0 && <p className="rt-tags">{v.tagsLabel}{v.tags.join(', ')}</p>}
      {v.extraLines.filter(Boolean).map((l, i) => <p key={i} className="rt-extra">{l}</p>)}
    </>
  )
}

function Runs({ runs }: { runs: RichRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: ReactNode = r.text
        if (r.bold) node = <strong>{node}</strong>
        if (r.italic) node = <em>{node}</em>
        if (r.underline) node = <u>{node}</u>
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

/**
 * Rich text as React nodes — parseRichBlocks means no markup string ever
 * reaches the DOM raw (the house rule: no dangerouslySetInnerHTML).
 */
function RichBody({ html }: { html: string }) {
  const blocks = parseRichBlocks(html)
  const out: ReactNode[] = []
  let list: RichBlock[] = []
  const flushList = (key: string) => {
    if (!list.length) return
    const ordered = list[0].kind === 'list-item' && list[0].ordered
    const items = list.map((b, i) => <li key={i}><Runs runs={b.runs} /></li>)
    out.push(ordered ? <ol key={key} className="rt-points">{items}</ol> : <ul key={key} className="rt-points">{items}</ul>)
    list = []
  }
  blocks.forEach((b, i) => {
    if (b.kind === 'list-item') { list.push(b); return }
    flushList(`l${i}`)
    out.push(<p key={i} className="rt-para"><Runs runs={b.runs} /></p>)
  })
  flushList('tail')
  return <>{out}</>
}

/** A point's body inline (a highlight is one line; its breaks read as spaces). */
function RichInline({ html }: { html: string }) {
  const runs = parseRichBlocks(html).flatMap((b) => b.runs)
  return <Runs runs={runs} />
}
