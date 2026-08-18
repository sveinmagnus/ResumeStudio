import type { ReactNode } from 'react'

/**
 * The standard descriptive blurb shown at the top of an editor section — a
 * sunken paragraph with a navy accent rule. Shared so every section that
 * explains itself renders the same treatment; a section that styles its own
 * blurb is how the variants drift apart.
 */
export function SectionIntro({ children }: { children: ReactNode }) {
  return (
    <>
      <p className="section-intro">{children}</p>
      <style>{`
        .section-intro {
          font-size: 13.5px; color: var(--ink-soft); line-height: 1.55;
          padding: 12px 14px; margin-bottom: 16px;
          background: var(--paper-sunken); border-left: 3px solid var(--accent);
          border-radius: var(--r-sm);
        }
      `}</style>
    </>
  )
}
