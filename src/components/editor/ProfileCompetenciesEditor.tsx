import { ProfileEditor, KeyCompetenciesEditor } from './SimpleEditors'
import { sectionLabel } from '../../lib/sections'

/**
 * "Profile & Competencies" — one page for the two profile content sections
 * that used to hide behind Personal Details sub-tabs:
 *
 *   - Professional summary (the key_qualifications blocks)
 *   - Key competencies  (the key_competencies entries)
 *
 * They stay separate sections in the data model and in exports; this page
 * only merges the EDITING surface so the sidebar is the single navigation
 * pattern. The legacy section keys ('key_qualifications',
 * 'key_competencies') still route here — see canonicalSectionKey in
 * lib/sections.ts.
 */
export function ProfileCompetenciesEditor() {
  return (
    <div className="section-pane">
      <section aria-labelledby="pc-profile-heading" className="pc-block">
        <h2 id="pc-profile-heading" className="pc-heading">{sectionLabel('key_qualifications')}</h2>
        <ProfileEditor />
      </section>

      <section aria-labelledby="pc-competencies-heading" className="pc-block">
        <h2 id="pc-competencies-heading" className="pc-heading">{sectionLabel('key_competencies')}</h2>
        <KeyCompetenciesEditor />
      </section>

      <style>{`
        .pc-block { margin-bottom: 36px; }
        .pc-block:last-of-type { margin-bottom: 0; }
        .pc-heading {
          font-size: 22px; color: var(--accent);
          padding-bottom: 8px; margin-bottom: 16px;
          border-bottom: 1px solid var(--line);
        }
        /* The sub-editors bring their own .section-pane wrapper (fadeUp
           animation) — fine nested, but kill the double entrance animation
           so the page doesn't stagger-fade twice. */
        .pc-block .section-pane { animation: none; }
      `}</style>
    </div>
  )
}
