import { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { buildCareerTimeline, monthsToLabel, type TimelineBar } from '../../lib/careerTimeline'

/**
 * Career timeline card (roadmap F15) — a horizontal, overlap-packed view of
 * employments and projects on the Overview, surfacing gaps in the work
 * history. Pure geometry comes from lib/careerTimeline; this component only
 * positions DOM elements as percentages of the [minMonths, maxMonths] span so
 * it stays responsive without SVG text scaling. Renders nothing when there's
 * no dated history to draw.
 */
export function CareerTimeline() {
  const { data, primaryLocale, setActiveSection, setExpandedItem } = useStore()

  const model = useMemo(
    () => buildCareerTimeline(data, primaryLocale),
    [data, primaryLocale],
  )

  if (!model.hasData) return null

  const { minMonths, maxMonths, years, employment, projects, gaps } = model
  const span = Math.max(1, maxMonths - minMonths)
  const pct = (months: number) => ((months - minMonths) / span) * 100

  const LANE = 24          // employment lane height (px)
  const PROJ_LANE = 17     // project lane height (px)
  const AXIS = 18          // top year-label band
  const empHeight = Math.max(LANE, employment.lanes * LANE)
  const projHeight = projects.lanes * PROJ_LANE
  const trackGap = projects.bars.length ? 12 : 0
  const total = AXIS + empHeight + trackGap + projHeight + 6

  const goto = (bar: TimelineBar) => {
    setActiveSection(bar.kind === 'employment' ? 'work_experiences' : 'projects')
    setExpandedItem(bar.id)
  }

  const rangeLabel = (b: TimelineBar) =>
    `${monthsToLabel(b.startMonths)} – ${b.ongoing ? 'Present' : monthsToLabel(b.endMonths)}`

  return (
    <div className="ct-card">
      <div className="ct-head">
        <h3 className="ov-section-title ct-title">Career timeline</h3>
        {gaps.length > 0 && (
          <span className="ct-gap-note">
            {gaps.length} gap{gaps.length !== 1 ? 's' : ''} in employment
          </span>
        )}
      </div>

      <div className="ct-chart" style={{ height: total }} role="group" aria-label="Career timeline">
        {/* Year gridlines + labels */}
        {years.map((y) => (
          <div key={y} className="ct-grid" style={{ left: `${pct(y * 12)}%` }} aria-hidden="true">
            <span className="ct-grid-label">{y}</span>
          </div>
        ))}

        {/* Employment gaps (drawn under the bars, across the employment band) */}
        {gaps.map((g, i) => (
          <div
            key={`gap-${i}`}
            className="ct-gap"
            style={{
              left: `${pct(g.startMonths)}%`,
              width: `${Math.max(0.5, pct(g.endMonths + 1) - pct(g.startMonths))}%`,
              top: AXIS, height: empHeight,
            }}
            title={`Employment gap: ${g.months} month${g.months !== 1 ? 's' : ''} (${monthsToLabel(g.startMonths)} – ${monthsToLabel(g.endMonths)})`}
          >
            <span className="sr-only">
              Employment gap of {g.months} months from {monthsToLabel(g.startMonths)} to {monthsToLabel(g.endMonths)}
            </span>
          </div>
        ))}

        {/* Employment bars */}
        {employment.bars.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`ct-bar ct-emp${b.ongoing ? ' ct-ongoing' : ''}`}
            style={{
              left: `${pct(b.startMonths)}%`,
              width: `${Math.max(0.8, pct(b.endMonths + 1) - pct(b.startMonths))}%`,
              top: AXIS + b.lane * LANE, height: LANE - 6,
            }}
            onClick={() => goto(b)}
            title={`${b.label}${b.sublabel ? ` — ${b.sublabel}` : ''} · ${rangeLabel(b)}`}
            aria-label={`Employment: ${b.label}, ${rangeLabel(b)}`}
          >
            <span className="ct-bar-label">{b.label}</span>
          </button>
        ))}

        {/* Project bars (thinner track below) */}
        {projects.bars.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`ct-bar ct-proj${b.ongoing ? ' ct-ongoing' : ''}`}
            style={{
              left: `${pct(b.startMonths)}%`,
              width: `${Math.max(0.8, pct(b.endMonths + 1) - pct(b.startMonths))}%`,
              top: AXIS + empHeight + trackGap + b.lane * PROJ_LANE, height: PROJ_LANE - 4,
            }}
            onClick={() => goto(b)}
            title={`${b.label}${b.sublabel ? ` — ${b.sublabel}` : ''} · ${rangeLabel(b)}`}
            aria-label={`Project: ${b.label}, ${rangeLabel(b)}`}
          >
            <span className="ct-bar-label ct-bar-label-sm">{b.label}</span>
          </button>
        ))}
      </div>

      <div className="ct-legend">
        <span className="ct-key ct-key-emp">Employment</span>
        {projects.bars.length > 0 && <span className="ct-key ct-key-proj">Projects</span>}
        {gaps.length > 0 && <span className="ct-key ct-key-gap">Gap</span>}
      </div>

      <style>{`
        .ct-card { margin: 28px 0 8px; }
        .ct-head { display: flex; align-items: baseline; gap: 12px; }
        .ct-title { margin: 0; }
        .ct-gap-note {
          font-size: 12px; font-weight: 600; color: var(--err-ink);
          background: var(--err-wash); padding: 2px 8px; border-radius: 10px;
        }
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
        .ct-proj { background: var(--secondary-ink-text); color: #fff; }
        .ct-ongoing { border-right: 3px solid var(--gold); }
        .ct-bar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
        .ct-bar-label-sm { font-weight: 500; font-size: 10.5px; }
        .ct-legend { display: flex; gap: 16px; margin-top: 8px; font-size: 11.5px; color: var(--ink-soft); }
        .ct-key { display: inline-flex; align-items: center; gap: 6px; }
        .ct-key::before { content: ''; width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
        .ct-key-emp::before { background: var(--accent); }
        .ct-key-proj::before { background: var(--secondary-ink-text); }
        .ct-key-gap::before {
          background: repeating-linear-gradient(45deg, var(--err-wash), var(--err-wash) 3px, var(--err-ink) 3px, var(--err-ink) 4px);
        }
      `}</style>
    </div>
  )
}
