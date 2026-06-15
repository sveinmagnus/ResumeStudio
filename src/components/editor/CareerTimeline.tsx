import { useMemo, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { buildCareerTimeline, monthsToLabel, type CareerTimelineModel, type TimelineBar, type TimelineKind } from '../../lib/careerTimeline'
import { useDialog } from '../ui/useDialog'

/**
 * Career timeline card (roadmap F15) — a horizontal, overlap-packed view of
 * employments, education and projects on the Overview, surfacing gaps in the
 * work history (education counts as coverage, so study periods aren't gaps).
 * Pure geometry comes from lib/careerTimeline; this component only positions
 * DOM elements as percentages of the [minMonths, maxMonths] span so it stays
 * responsive without SVG text scaling. A zoom button opens the same chart in a
 * full-viewport-width modal so short project bars become readable. Renders
 * nothing when there's no dated history to draw.
 */
export function CareerTimeline() {
  const { data, primaryLocale, setActiveSection, setExpandedItem } = useStore()
  const [zoomed, setZoomed] = useState(false)

  const model = useMemo(
    () => buildCareerTimeline(data, primaryLocale),
    [data, primaryLocale],
  )

  if (!model.hasData) return null

  const sectionFor: Record<TimelineKind, string> = {
    employment: 'work_experiences',
    education: 'educations',
    project: 'projects',
  }

  const goto = (bar: TimelineBar) => {
    setActiveSection(sectionFor[bar.kind])
    setExpandedItem(bar.id)
  }

  const { gaps } = model

  return (
    <div className="ct-card">
      <div className="ct-head">
        <h3 className="ov-section-title ct-title">Career timeline</h3>
        {gaps.length > 0 && (
          <span className="ct-gap-note">
            {gaps.length} gap{gaps.length !== 1 ? 's' : ''} in work history
          </span>
        )}
        <button
          type="button"
          className="ct-zoom"
          onClick={() => setZoomed(true)}
          aria-label="Expand timeline to full width"
          title="Expand to full width"
        >
          <Maximize2 size={14} /> Expand
        </button>
      </div>

      <TimelineChart model={model} expanded={false} onSelect={goto} />

      <TimelineLegend model={model} />

      {zoomed && (
        <TimelineZoomModal
          model={model}
          onClose={() => setZoomed(false)}
          onSelect={(bar) => { setZoomed(false); goto(bar) }}
        />
      )}

      <style>{`
        .ct-card { margin: 28px 0 8px; }
        .ct-head { display: flex; align-items: baseline; gap: 12px; }
        .ct-title { margin: 0; }
        .ct-gap-note {
          font-size: 12px; font-weight: 600; color: var(--err-ink);
          background: var(--err-wash); padding: 2px 8px; border-radius: 10px;
        }
        .ct-zoom {
          margin-left: auto; align-self: center;
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 10px; border-radius: var(--r-sm);
          font-size: 12.5px; font-weight: 600; color: var(--ink-soft);
          border: 1px solid var(--line); background: var(--paper);
          transition: color .12s, border-color .12s, background .12s;
        }
        .ct-zoom:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-wash); }

        .ct-chart {
          position: relative; width: 100%; margin-top: 12px;
          border: 1px solid var(--line); border-radius: var(--r-md);
          background: var(--paper-raised); overflow: hidden;
        }
        .ct-grid {
          position: absolute; top: 0; bottom: 0; width: 0;
          border-left: 1px dashed var(--line);
        }
        .ct-grid-label {
          position: absolute; top: 2px; left: 3px;
          font-size: 10px; color: var(--ink-faint); font-weight: 600;
        }
        .ct-chart-expanded .ct-grid-label { font-size: 12px; }
        .ct-gap {
          position: absolute;
          background: repeating-linear-gradient(
            45deg, var(--err-wash), var(--err-wash) 5px, transparent 5px, transparent 10px);
          border-left: 1px solid var(--err-ink); border-right: 1px solid var(--err-ink);
        }
        .ct-bar {
          position: absolute; display: flex; align-items: center;
          border-radius: 4px; padding: 0 6px; overflow: hidden;
          font-size: 11px; color: #fff; text-align: left;
          box-shadow: var(--shadow-sm); transition: filter .12s, outline .12s;
        }
        .ct-bar:hover { filter: brightness(1.08); }
        .ct-emp { background: var(--accent); }
        .ct-edu { background: var(--ok-ink); }
        .ct-proj { background: var(--secondary-ink-text); color: #fff; }
        .ct-ongoing { border-right: 3px solid var(--gold); }
        .ct-bar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
        .ct-bar-label-sm { font-weight: 500; font-size: 10.5px; }
        .ct-chart-expanded .ct-bar { font-size: 13px; padding: 0 9px; }
        .ct-chart-expanded .ct-bar-label-sm { font-size: 12px; }

        .ct-legend { display: flex; gap: 16px; margin-top: 8px; font-size: 11.5px; color: var(--ink-soft); flex-wrap: wrap; }
        .ct-key { display: inline-flex; align-items: center; gap: 6px; }
        .ct-key::before { content: ''; width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
        .ct-key-emp::before { background: var(--accent); }
        .ct-key-edu::before { background: var(--ok-ink); }
        .ct-key-proj::before { background: var(--secondary-ink-text); }
        .ct-key-gap::before {
          background: repeating-linear-gradient(45deg, var(--err-wash), var(--err-wash) 3px, var(--err-ink) 3px, var(--err-ink) 4px);
        }

        /* Zoom modal */
        .ct-zoom-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.35);
          display: grid; place-items: center; z-index: 100; animation: fadeIn .15s ease;
        }
        .ct-zoom-modal {
          background: var(--paper); border-radius: var(--r-md);
          padding: 20px 24px 22px; width: 96vw; max-width: 96vw;
          max-height: 92vh; overflow: auto; box-shadow: var(--shadow-lg);
        }
        .ct-zoom-head { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
        .ct-zoom-head h3 { font-size: 22px; margin: 0; }
        .ct-zoom-close {
          margin-left: auto; width: 32px; height: 32px; display: grid; place-items: center;
          border-radius: var(--r-sm); color: var(--ink-faint); transition: color .12s, background .12s;
        }
        .ct-zoom-close:hover { background: var(--paper-sunken); color: var(--accent); }
      `}</style>
    </div>
  )
}

// ─── The chart itself (shared by the inline card and the zoom modal) ─────────

interface ChartProps {
  model: CareerTimelineModel
  /** Larger lanes + fonts for the full-width modal. */
  expanded: boolean
  onSelect: (bar: TimelineBar) => void
}

interface LaidTrack {
  kind: TimelineKind
  bars: TimelineBar[]
  laneHeight: number
  barInset: number
  barClass: string
  labelSmall: boolean
  /** Counts toward gap coverage (employment + education). */
  isWork: boolean
  top: number
  height: number
}

function TimelineChart({ model, expanded, onSelect }: ChartProps) {
  const { minMonths, maxMonths, years, employment, education, projects, gaps } = model
  const span = Math.max(1, maxMonths - minMonths)
  const pct = (months: number) => ((months - minMonths) / span) * 100

  const k = expanded ? 1.55 : 1
  const AXIS = 18
  const trackGap = expanded ? 16 : 12

  // Order: employment, education, then projects. Only tracks with bars render.
  const defs: Array<Omit<LaidTrack, 'top' | 'height'> & { lanes: number }> = [
    { kind: 'employment' as const, bars: employment.bars, lanes: employment.lanes, laneHeight: Math.round(24 * k), barInset: 6, barClass: 'ct-emp', labelSmall: false, isWork: true },
    { kind: 'education' as const, bars: education.bars, lanes: education.lanes, laneHeight: Math.round(20 * k), barInset: 6, barClass: 'ct-edu', labelSmall: false, isWork: true },
    { kind: 'project' as const, bars: projects.bars, lanes: projects.lanes, laneHeight: Math.round(17 * k), barInset: 4, barClass: 'ct-proj', labelSmall: true, isWork: false },
  ].filter((d) => d.bars.length > 0)

  // Stack the present tracks vertically, recording each one's [top, height].
  let cursor = AXIS
  const laid: LaidTrack[] = defs.map((d) => {
    const lanes = Math.max(1, d.lanes)
    const height = lanes * d.laneHeight
    const top = cursor
    cursor += height + trackGap
    return { ...d, top, height }
  })
  const totalHeight = (laid.length ? cursor - trackGap : AXIS) + 6

  // The gap band spans the work tracks (employment + education) that are present.
  const workTracks = laid.filter((t) => t.isWork)
  const gapTop = workTracks.length ? workTracks[0].top : AXIS
  const gapBottom = workTracks.length
    ? workTracks[workTracks.length - 1].top + workTracks[workTracks.length - 1].height
    : AXIS
  const gapHeight = Math.max(0, gapBottom - gapTop)

  const kindLabel: Record<TimelineKind, string> = {
    employment: 'Employment', education: 'Education', project: 'Project',
  }
  const rangeLabel = (b: TimelineBar) =>
    `${monthsToLabel(b.startMonths)} – ${b.ongoing ? 'Present' : monthsToLabel(b.endMonths)}`

  return (
    <div
      className={`ct-chart${expanded ? ' ct-chart-expanded' : ''}`}
      style={{ height: totalHeight }}
      role="group"
      aria-label="Career timeline"
    >
      {/* Year gridlines + labels */}
      {years.map((y) => (
        <div key={y} className="ct-grid" style={{ left: `${pct(y * 12)}%` }} aria-hidden="true">
          <span className="ct-grid-label">{y}</span>
        </div>
      ))}

      {/* Work-history gaps (drawn under the bars, across the work tracks) */}
      {gapHeight > 0 && gaps.map((g, i) => (
        <div
          key={`gap-${i}`}
          className="ct-gap"
          style={{
            left: `${pct(g.startMonths)}%`,
            width: `${Math.max(0.5, pct(g.endMonths + 1) - pct(g.startMonths))}%`,
            top: gapTop, height: gapHeight,
          }}
          title={`Gap: ${g.months} month${g.months !== 1 ? 's' : ''} with no work or education (${monthsToLabel(g.startMonths)} – ${monthsToLabel(g.endMonths)})`}
        >
          <span className="sr-only">
            Career gap of {g.months} months from {monthsToLabel(g.startMonths)} to {monthsToLabel(g.endMonths)}
          </span>
        </div>
      ))}

      {/* Bars, track by track */}
      {laid.flatMap((t) =>
        t.bars.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`ct-bar ${t.barClass}${b.ongoing ? ' ct-ongoing' : ''}`}
            style={{
              left: `${pct(b.startMonths)}%`,
              width: `${Math.max(0.8, pct(b.endMonths + 1) - pct(b.startMonths))}%`,
              top: t.top + b.lane * t.laneHeight, height: t.laneHeight - t.barInset,
            }}
            onClick={() => onSelect(b)}
            title={`${b.label}${b.sublabel ? ` — ${b.sublabel}` : ''} · ${rangeLabel(b)}`}
            aria-label={`${kindLabel[t.kind]}: ${b.label}, ${rangeLabel(b)}`}
          >
            <span className={`ct-bar-label${t.labelSmall ? ' ct-bar-label-sm' : ''}`}>{b.label}</span>
          </button>
        )),
      )}
    </div>
  )
}

function TimelineLegend({ model }: { model: CareerTimelineModel }) {
  return (
    <div className="ct-legend">
      <span className="ct-key ct-key-emp">Employment</span>
      {model.education.bars.length > 0 && <span className="ct-key ct-key-edu">Education</span>}
      {model.projects.bars.length > 0 && <span className="ct-key ct-key-proj">Projects</span>}
      {model.gaps.length > 0 && <span className="ct-key ct-key-gap">Gap</span>}
    </div>
  )
}

// ─── Full-width zoom modal ───────────────────────────────────────────────────

interface ZoomProps {
  model: CareerTimelineModel
  onClose: () => void
  onSelect: (bar: TimelineBar) => void
}

function TimelineZoomModal({ model, onClose, onSelect }: ZoomProps) {
  const dialogRef = useDialog(onClose)
  return (
    <div className="ct-zoom-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ct-zoom-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Career timeline (expanded)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ct-zoom-head">
          <h3>Career timeline</h3>
          {model.gaps.length > 0 && (
            <span className="ct-gap-note">
              {model.gaps.length} gap{model.gaps.length !== 1 ? 's' : ''} in work history
            </span>
          )}
          <button className="ct-zoom-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <TimelineChart model={model} expanded onSelect={onSelect} />
        <TimelineLegend model={model} />
      </div>
    </div>
  )
}
