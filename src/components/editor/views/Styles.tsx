// ─── Shared styles for the views editor family ───────────────────────────────
// One rv-* stylesheet spans ResumeViewsEditor, ViewEditor, and the control
// subcomponents (they render as one visual surface). Rendered once by whichever
// top-level pane is active (ViewList or ViewEditor).

export function Styles() {
  return (
    <style>{`
      .rv-pane { animation: fadeUp .25s ease; }

      /* ── List view ── */
      .rv-list-intro {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
        margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--line);
      }
      .rv-list-intro p { font-size: 14px; color: var(--ink-soft); max-width: 620px; line-height: 1.6; }
      .rv-create-btn {
        display: inline-flex; align-items: center; gap: 7px; padding: 10px 18px;
        background: var(--accent); color: #fff; border-radius: var(--r-md);
        font-weight: 600; font-size: 14px; white-space: nowrap; transition: background .15s; flex-shrink: 0;
      }
      .rv-create-btn:hover { background: var(--accent-bright); }
      .rv-create-row { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
      .rv-tailor-btn { background: var(--paper-raised); color: var(--accent); border: 1px solid var(--accent); }
      .rv-tailor-btn:hover { background: var(--accent-wash); }

      .rv-empty {
        text-align: center; padding: 60px 20px; color: var(--ink-faint);
        display: flex; flex-direction: column; align-items: center; gap: 10px;
      }
      .rv-empty p { font-size: 15px; }
      .rv-empty-sub { font-size: 13px; }

      .rv-cards { display: flex; flex-direction: column; gap: 10px; }
      .rv-card {
        display: flex; align-items: center; gap: 14px; padding: 16px 18px;
        background: var(--paper-raised); border: 1px solid var(--line);
        border-radius: var(--r-md); transition: border-color .15s;
      }
      .rv-card:hover { border-color: var(--accent); }
      .rv-card-icon { color: var(--accent); flex-shrink: 0; }
      .rv-card-body { flex: 1; min-width: 0; }
      .rv-card-name { font-weight: 600; font-size: 15px; }
      .rv-card-meta { font-size: 12px; color: var(--ink-faint); margin-top: 2px; }
      .rv-card-actions { display: flex; align-items: center; gap: 8px; }

      /* ── Shared buttons ── */
      .rv-btn-edit {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px;
        background: var(--accent-wash); color: var(--accent); border-radius: var(--r-sm);
        font-size: 13px; font-weight: 600; transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
      }
      .rv-btn-edit:hover { background: var(--accent); color: #fff; }
      .rv-btn-del {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 7px; border-radius: var(--r-sm); color: var(--ink-faint);
        transition: color .13s, background .13s, border-color .13s, box-shadow .13s; font-size: 13px;
      }
      .rv-btn-del:hover { background: #fee2e2; color: #b91c1c; }

      /* ── Editor header ── */
      .rv-editor-header {
        display: flex; align-items: center; gap: 12px; row-gap: 10px; margin-bottom: 24px;
        padding-bottom: 20px; border-bottom: 1px solid var(--line); flex-wrap: wrap;
      }
      .rv-back-btn {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
        background: var(--paper-sunken); border-radius: var(--r-sm);
        font-size: 13px; color: var(--ink-soft); transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
      }
      .rv-back-btn:hover { color: var(--accent); }
      .rv-editor-stats { flex: 1; font-size: 13px; color: var(--ink-faint); }
      .rv-del-view { gap: 6px; padding: 7px 12px; font-size: 13px; }
      .rv-preview-controls { display: flex; align-items: center; gap: 6px; }
      .rv-prev-ctrl {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
        background: var(--paper-sunken); border: 1px solid var(--line); border-radius: var(--r-sm);
        font-size: 12.5px; font-weight: 600; color: var(--ink-soft); transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
      }
      .rv-prev-ctrl:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }

      /* ── Field blocks ── */
      .rv-section-block {
        margin-bottom: 32px; padding-bottom: 32px; border-bottom: 1px solid var(--line);
      }
      .rv-section-block:last-child { border-bottom: none; }
      .rv-block-heading {
        font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
        color: var(--ink-faint); margin-bottom: 6px;
      }
      .rv-block-desc { font-size: 13px; color: var(--ink-soft); margin-bottom: 14px; }
      .rv-field-label {
        display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
        text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
      }
      .rv-name-input {
        width: 100%; padding: 9px 11px; background: var(--paper-raised);
        border: 1px solid var(--line); border-radius: var(--r-sm);
        font-size: 15px; font-weight: 600; transition: border-color .15s, box-shadow .15s;
      }
      .rv-name-input:focus {
        outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash);
      }
      /* Collapsed (display) state — the name reads as a heading with an edit pencil. */
      .rv-name-display { display: flex; align-items: center; gap: 8px; }
      .rv-view-name { font-size: 20px; font-weight: 600; color: var(--ink); margin: 0; }
      .rv-name-edit-btn {
        display: grid; place-items: center; padding: 5px; color: var(--ink-faint);
        border: 1px solid transparent; border-radius: var(--r-sm); cursor: pointer;
        transition: color .12s, background .12s, border-color .12s;
      }
      .rv-name-edit-btn:hover { color: var(--accent); background: var(--accent-wash); border-color: var(--line); }

      /* ── Section list ── */
      .rv-section-list { display: flex; flex-direction: column; gap: 6px; }
      .rv-sec-row {
        display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px;
        border: 1px solid var(--line); border-radius: var(--r-md);
        background: var(--paper-raised); transition: border-color .15s;
      }
      .rv-sec-on { border-color: var(--line); }
      .rv-sec-off { opacity: .55; background: var(--paper-sunken); }

      /* Drag handle at the left, the up/down reorder arrows to its right (one
         compact horizontal strip rather than a tall stacked column). */
      .rv-sec-controls { display: flex; flex-direction: row; align-items: center; gap: 1px; flex-shrink: 0; }
      .rv-ord-btn {
        display: flex; align-items: center; justify-content: center;
        width: 20px; height: 22px; border-radius: var(--r-sm);
        color: var(--ink-faint); transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
      }
      .rv-ord-btn:hover:not(:disabled) { background: var(--paper-sunken); color: var(--ink); }
      .rv-ord-btn:disabled { opacity: .25; cursor: default; }

      .rv-sec-content { flex: 1; min-width: 0; }
      /* The header + collapsed chips toggle the section open/closed on click
         (the detail toggle and the expanded panels opt out in the handler). */
      .rv-sec-clickable > .rv-sec-top,
      .rv-sec-clickable > .rv-sec-config { cursor: pointer; }
      .rv-sec-top {
        display: flex; align-items: center;
        gap: 12px; flex-wrap: wrap;
      }
      .rv-sec-title-line { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
      .rv-sec-title { font-weight: 600; font-size: 14px; }
      .rv-sec-count {
        font-size: 11px; font-weight: 500; padding: 1px 7px;
        background: var(--paper-sunken); color: var(--ink-faint); border-radius: 10px;
      }
      /* Toggle + expand arrow as one flush-right unit — margin-left: auto here
         (not justify-content: space-between on the row) keeps the toggle glued
         to the arrow on every row regardless of the title's length or how many
         buttons this section's toggle has (2-way vs 4-way, see sectionModes). */
      .rv-sec-mode-group { display: flex; align-items: center; gap: 8px; margin-left: auto; }

      /* ── Detail segmented control ── */
      .rv-detail-toggle {
        display: inline-flex; align-items: stretch; background: var(--paper-sunken);
        border: 1px solid var(--line); border-radius: var(--r-sm); padding: 2px;
        gap: 1px;
      }
      .rv-detail-opt {
        padding: 4px 10px; font-size: 11px; font-weight: 600; letter-spacing: .04em;
        text-transform: uppercase; color: var(--ink-faint);
        border-radius: 3px; transition: color .13s, background .13s, border-color .13s, box-shadow .13s; min-width: 56px; text-align: center;
      }
      .rv-detail-opt:hover { color: var(--accent); }
      .rv-detail-opt.is-active {
        background: var(--accent); color: #fff;
      }
      .rv-detail-opt.is-active:hover { color: #fff; }

      /* ── Section style panel ── */
      .rv-secstyle {
        margin-top: 8px; padding: 9px 11px;
        background: var(--paper-sunken); border-radius: var(--r-sm);
      }
      .rv-secstyle-header {
        display: flex; align-items: center; gap: 7px;
        font-size: 11px; font-weight: 600; color: var(--ink-soft);
        letter-spacing: .04em; text-transform: uppercase; user-select: none;
      }
      .rv-secstyle-header .rv-secstyle-badge {
        font-size: 9px; padding: 1px 6px; border-radius: 9px;
        background: var(--accent-wash); color: var(--accent); font-weight: 700;
        letter-spacing: .04em;
      }
      .rv-secstyle-header .rv-secstyle-reset {
        margin-left: auto; padding: 2px 6px; border-radius: var(--r-sm);
        color: var(--ink-faint); display: inline-flex; align-items: center; gap: 3px;
        font-size: 10px; font-weight: 600; cursor: pointer;
      }
      .rv-secstyle-header .rv-secstyle-reset:hover { color: var(--accent); background: var(--paper); }

      /* ── Section expand/collapse chevron + collapsed config overview ── */
      .rv-sec-expand {
        display: grid; place-items: center; padding: 4px;
        color: var(--ink-faint); border-radius: var(--r-sm); cursor: pointer;
        transition: color .13s, background .13s;
      }
      .rv-sec-expand:hover { color: var(--accent); background: var(--paper-sunken); }
      .rv-sec-expand .rv-chev-open { transform: rotate(90deg); }
      .rv-sec-config { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
      .rv-sec-chip {
        font-size: 10.5px; font-weight: 500; padding: 2px 8px; border-radius: 10px;
        background: var(--accent-wash); color: var(--accent); white-space: nowrap;
      }
      .rv-sec-config-empty { font-size: 11px; color: var(--ink-faint); font-style: italic; }
      /* Toggles (left) | dropdowns (right). */
      .rv-secstyle-body {
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 10px 18px; margin-top: 10px; align-items: start;
      }
      .rv-secstyle-toggles { display: flex; flex-direction: column; gap: 8px; }
      .rv-secstyle-selects { display: flex; flex-direction: column; gap: 8px; }
      /* Checkbox sits BEFORE its label text so what's toggled is unambiguous. */
      .rv-toggle {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: var(--ink-soft); cursor: pointer;
      }
      .rv-toggle input[type=checkbox] { flex-shrink: 0; accent-color: var(--accent); width: 15px; height: 15px; }
      /* Stack the label above the control so every dropdown is the SAME width
         (the full column cell) rather than sized to its content. */
      .rv-sel {
        display: flex; flex-direction: column; align-items: stretch; gap: 3px;
        font-size: 12px; color: var(--ink-soft);
      }
      .rv-sel select {
        width: 100%; font-size: 12px; padding: 3px 6px; border: 1px solid var(--line);
        border-radius: var(--r-sm); background: var(--paper);
      }
      .rv-secstyle-heading { margin-top: 12px; }

      /* Professional-summary "show parts" — a core, always-visible control row. */
      .rv-kq-parts {
        display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px;
        margin: 10px 0 4px; padding: 9px 12px;
        background: var(--accent-wash); border: 1px solid var(--secondary-line);
        border-radius: var(--r-sm);
      }
      .rv-kq-parts-label {
        font-size: 10px; font-weight: 700; letter-spacing: .07em;
        text-transform: uppercase; color: var(--accent);
      }
      .rv-kq-part { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); cursor: pointer; }
      .rv-kq-part input { accent-color: var(--accent); width: 15px; height: 15px; flex-shrink: 0; }

      /* ── View styling block ── */
      .rv-vs-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
      }
      .rv-vs-field { display: flex; flex-direction: column; gap: 5px; }
      .rv-vs-label {
        font-size: 10px; font-weight: 700; letter-spacing: .08em;
        text-transform: uppercase; color: var(--ink-faint);
      }
      .rv-vs-select, .rv-vs-color {
        padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper-raised); font-size: 14px;
      }
      .rv-vs-select:focus, .rv-vs-color:focus {
        outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash);
      }
      .rv-vs-color-row { display: flex; align-items: center; gap: 8px; }
      .rv-vs-color { padding: 4px; width: 44px; height: 32px; cursor: pointer; }
      .rv-vs-hex {
        padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper-raised); font-family: monospace; font-size: 13px;
        width: 96px;
      }
      .rv-vs-reset {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 7px 12px; border-radius: var(--r-sm);
        background: var(--paper-sunken); color: var(--ink-soft);
        font-size: 12px; font-weight: 600; transition: color .13s, background .13s, border-color .13s, box-shadow .13s; margin-top: 10px;
      }
      .rv-vs-reset:hover { color: var(--accent); background: var(--accent-wash); }
      .rv-vs-fonthint { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; }
      .rv-vs-fontlink {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11.5px; font-weight: 600; color: var(--accent); text-decoration: none;
      }
      .rv-vs-fontlink:hover { text-decoration: underline; }

      /* ── Header controls ── */
      .rv-hdr-sub {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
        color: var(--ink-faint); margin: 18px 0 10px; padding-top: 14px;
        border-top: 1px solid var(--line);
      }
      .rv-hdr > .rv-hdr-sub:first-child { margin-top: 0; padding-top: 0; border-top: none; }
      .rv-hdr-note { font-size: 12px; color: var(--ink-soft); margin-bottom: 10px; line-height: 1.5; }
      .rv-hdr-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .rv-hdr-type { display: flex; flex-direction: column; gap: 5px; }
      .rv-hdr-type-row { display: flex; align-items: center; gap: 6px; }
      .rv-hdr-type-row .rv-vs-select { flex: 1; min-width: 0; }
      .rv-hdr-size {
        width: 70px; padding: 7px 8px; border: 1px solid var(--line);
        border-radius: var(--r-sm); background: var(--paper-raised); font-size: 14px;
      }
      .rv-hdr-size:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
      .rv-hdr-pt { font-size: 12px; color: var(--ink-faint); }
      .rv-hdr-sep {
        display: inline-flex; align-items: center; gap: 6px; text-transform: none;
        letter-spacing: 0; font-weight: 600; font-size: 11px; color: var(--ink-soft);
      }
      .rv-hdr-sep-input {
        width: 48px; padding: 3px 6px; border: 1px solid var(--line); border-radius: var(--r-sm);
        background: var(--paper); text-align: center; font-family: monospace; font-size: 13px;
      }
      .rv-hdr-fields { display: flex; flex-direction: column; gap: 4px; }
      .rv-hdr-field {
        display: flex; align-items: center; gap: 8px; padding: 5px 8px;
        border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper-raised);
      }
      .rv-hdr-field.is-off { opacity: .55; background: var(--paper-sunken); }
      .rv-hdr-ord { display: flex; flex-direction: column; flex-shrink: 0; }
      .rv-hdr-ord .rv-ord-btn { width: 20px; height: 16px; }
      .rv-hdr-show { display: inline-flex; align-items: center; flex-shrink: 0; }
      .rv-hdr-show input, .rv-hdr-sameline input { accent-color: var(--accent); }
      .rv-hdr-fname { font-size: 13px; font-weight: 500; width: 130px; flex-shrink: 0; }
      .rv-hdr-desc {
        flex: 1; min-width: 60px; padding: 5px 8px; border: 1px solid var(--line);
        border-radius: var(--r-sm); background: var(--paper); font-size: 13px;
      }
      .rv-hdr-desc:focus { outline: none; border-color: var(--accent); }
      .rv-hdr-desc:disabled { background: var(--paper-sunken); }
      .rv-hdr-sameline {
        display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
        font-size: 11.5px; color: var(--ink-soft); cursor: pointer;
      }
      .rv-hdr-img-grid {
        display: grid; grid-template-columns: minmax(160px, 220px) 1fr; gap: 16px; align-items: start;
      }
      .rv-hdr-img-grid .imgf-wrap { margin-bottom: 0; }
      /* Placement (+ shape) settings stacked to the right of the override upload. */
      .rv-hdr-img-settings { display: flex; flex-direction: column; gap: 14px; max-width: 320px; }
      .rv-hdr-title-override { margin-top: 14px; }
      .rv-hdr-url { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
      .rv-hdr-url-btn {
        display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
        padding: 5px 10px; font-size: 12px; font-weight: 600; color: var(--ink-soft);
        border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper);
        transition: color .12s, border-color .12s, background .12s;
      }
      .rv-hdr-url-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); background: var(--accent-wash); }
      .rv-hdr-url-btn:disabled { opacity: .55; cursor: default; }
      .rv-hdr-url-hint { font-size: 11.5px; color: var(--ink-faint); line-height: 1.4; }
      .rv-hdr-url-err { font-size: 11.5px; color: var(--err-ink); }
      .rv-spin { animation: rv-spin 1s linear infinite; }
      @keyframes rv-spin { to { transform: rotate(360deg); } }

      /* ── Item list: bulk selection tools ── */
      .rv-item-tools {
        display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;
        margin: 10px 0 0; padding: 7px 10px;
        background: var(--paper-sunken); border: 1px solid var(--line);
        border-radius: var(--r-sm);
      }
      .rv-item-tools-label {
        font-size: 10px; font-weight: 700; letter-spacing: .07em;
        text-transform: uppercase; color: var(--ink-faint);
      }
      .rv-item-tool-btn {
        padding: 3px 10px; font-size: 12px; font-weight: 500;
        border: 1px solid var(--line-strong); border-radius: var(--r-sm);
        background: var(--paper-raised); color: var(--ink-soft); cursor: pointer;
        transition: background .1s, color .1s, border-color .1s;
      }
      .rv-item-tool-btn:hover:not(:disabled) {
        background: var(--accent-wash); border-color: var(--accent); color: var(--accent);
      }
      /* Disabled = "already all / already none", i.e. feedback, not an error. */
      .rv-item-tool-btn:disabled { opacity: .4; cursor: default; }
      /* Separated from the All/None pair by a rule so the row reads as
         "bulk actions | filter by type" rather than one long strip of chips. */
      .rv-item-facets {
        display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px;
        padding-left: 10px; border-left: 1px solid var(--line);
      }
      .rv-item-facet {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; color: var(--ink-soft); cursor: pointer;
      }
      .rv-item-facet input { accent-color: var(--accent); width: 14px; height: 14px; flex-shrink: 0; }
      .rv-item-facet-name { white-space: nowrap; }
      .rv-item-facet-count { font-size: 11px; color: var(--ink-faint); font-variant-numeric: tabular-nums; }

      /* ── Item list ── */
      .rv-item-list { display: flex; flex-direction: column; gap: 1px; margin-top: 10px; }
      .rv-item-row {
        display: flex; align-items: center; gap: 10px; padding: 5px 8px;
        border-radius: var(--r-sm); cursor: pointer; transition: background .1s;
      }
      .rv-item-row:hover { background: var(--paper-sunken); }
      .rv-item-hidden { opacity: .45; }
      .rv-item-hidden .rv-item-title { text-decoration: line-through; }
      .rv-item-check { flex-shrink: 0; accent-color: var(--accent); width: 15px; height: 15px; }
      /* Title, star and date/subtitle share ONE line (wrap only if very long). */
      .rv-item-info { display: flex; flex-direction: row; align-items: center; flex-wrap: wrap; gap: 3px 8px; min-width: 0; }
      .rv-item-title { font-size: 13px; font-weight: 500; }
      .rv-item-star { color: var(--gold); flex-shrink: 0; }
      .rv-item-sub { font-size: 11px; color: var(--ink-faint); }
      .rv-item-empty { font-size: 12px; color: var(--ink-faint); padding: 6px 0 2px; font-style: italic; }

      /* ── Options ── */
      .rv-options-row { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
      .rv-opt-check {
        display: flex; align-items: center; gap: 7px; font-size: 14px; cursor: pointer;
      }
      .rv-opt-check input { accent-color: var(--accent); width: 15px; height: 15px; }
      .rv-opt-num { display: flex; align-items: center; gap: 8px; font-size: 14px; }
      .rv-page-input {
        width: 60px; padding: 6px 9px; background: var(--paper-raised);
        border: 1px solid var(--line); border-radius: var(--r-sm); text-align: center;
        font-size: 14px;
      }
      .rv-page-input:focus { outline: none; border-color: var(--accent); }

      /* ── Export (top-of-editor language selector + Export view dropdown) ── */
      .rv-locale-select {
        padding: 7px 10px; background: var(--paper-sunken); border: 1px solid var(--line);
        border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
        color: var(--ink-soft); min-width: 130px;
      }
      .rv-locale-select:hover { border-color: var(--accent); }
      .rv-locale-select:focus { outline: none; border-color: var(--accent); }
      .rv-exportmenu { position: relative; }
      .rv-export-trigger {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
        background: var(--accent); color: #fff; border-radius: var(--r-sm);
        font-size: 12.5px; font-weight: 600; transition: background .15s;
      }
      .rv-export-trigger:hover { background: var(--accent-bright); }
      .rv-exp-chev { transition: transform .15s; }
      .rv-exp-chev.open { transform: rotate(180deg); }
      .rv-export-pop {
        position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
        min-width: 210px; padding: 5px; background: var(--paper);
        border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--shadow-md);
        display: flex; flex-direction: column; gap: 1px;
        animation: rv-exp-fade .12s ease;
      }
      @keyframes rv-exp-fade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
      .rv-export-item {
        display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
        padding: 9px 11px; border-radius: var(--r-sm); font-size: 13px; font-weight: 600;
        color: var(--ink); transition: background .12s, color .12s;
      }
      .rv-export-item:hover:not(:disabled) { background: var(--accent-wash); color: var(--accent); }
      .rv-export-item:disabled { opacity: .6; cursor: progress; }
      .rv-export-item svg { color: var(--accent); flex-shrink: 0; }
      .rv-export-item:hover:not(:disabled) svg { color: var(--accent); }
      .rv-export-menu-foot {
        margin-top: 4px; padding: 7px 11px 3px; border-top: 1px solid var(--line);
        font-size: 11.5px; color: var(--ink-faint);
      }
      .rv-export-error {
        margin-top: 10px; display: flex; align-items: flex-start; gap: 8px;
        font-size: 12.5px; color: var(--err-ink); background: var(--err-wash);
        border: 1px solid var(--err-ink); border-radius: var(--r-sm); padding: 8px 10px;
      }
      .rv-export-error-top { margin-top: 0; margin-bottom: 20px; }
      .rv-export-error-x {
        margin-left: auto; flex-shrink: 0; color: var(--err-ink); font-size: 16px;
        line-height: 1; padding: 0 2px; cursor: pointer;
      }

      /* ── Live preview pane ── */
      .rv-editor-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 28px;
        align-items: start;
      }
      /* Preview hidden → single, comfortably-bounded controls column. */
      .rv-grid-solo { grid-template-columns: minmax(0, 860px); }
      .rv-editor-controls { min-width: 0; }
      .rv-preview-pane {
        position: sticky;
        /* Clear the sticky app header (its live height is published as
           --app-header-h; it wraps taller at some widths) so the pane sits fully
           within the viewport below it, and stay a touch shorter than the visible
           area so it never spills past the bottom edge and drift-scrolls. */
        top: calc(var(--app-header-h, 68px) + 12px);
        display: flex;
        flex-direction: column;
        height: calc(100vh - var(--app-header-h, 68px) - 28px);
        background: var(--paper-sunken);
        border: 1px solid var(--line);
        border-radius: var(--r-md);
        overflow: hidden;
      }
      .rv-preview-header {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 14px;
        background: var(--paper-raised);
        border-bottom: 1px solid var(--line);
      }
      .rv-preview-label {
        font-size: 11px; font-weight: 700; letter-spacing: .1em;
        text-transform: uppercase; color: var(--ink-faint);
      }
      .rv-preview-pages {
        margin-left: auto;
        font-size: 12px; color: var(--ink-soft);
        font-variant-numeric: tabular-nums;
      }
      .rv-preview-over { color: #b91c1c; font-weight: 600; }
      .rv-preview-head-actions { margin-left: auto; display: flex; align-items: center; gap: 2px; }
      .rv-preview-pages + .rv-preview-head-actions { margin-left: 10px; }
      .rv-preview-iconbtn {
        width: 28px; height: 26px; display: grid; place-items: center;
        border-radius: var(--r-sm); color: var(--ink-faint); transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
      }
      .rv-preview-iconbtn:hover { background: var(--accent-wash); color: var(--accent); }
      .rv-preview-frame {
        flex: 1; border: none; background: #fff; width: 100%;
      }
      @media (max-width: 1200px) {
        .rv-editor-grid { grid-template-columns: 1fr; }
        .rv-preview-pane { display: none; }
      }
    `}</style>
  )
}
