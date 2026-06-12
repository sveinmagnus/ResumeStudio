---
name: cartavio-brand
description: Apply Cartavio AS brand styling to a web project. Use when asked to style something "in Cartavio style" or "apply Cartavio branding". Cartavio is an IT advisory & angel investments firm (cartavio.no) with a navy/cyan brand identity. Colors verified directly from live site CSS.
---

# Cartavio Brand Guide

## Brand Identity
**Company:** Cartavio AS — IT advisory & angel investments  
**Website:** https://www.cartavio.no  
**Tagline:** "IT advisory & investments"

## Logo
- **Wordmark:** "Cartavio" in bold rounded geometric sans-serif, deep navy (#002E6E)
- **Symbol mark:** Abstract swirl — dark navy outer curve + bright cyan inner curve
- **Logo PNG (transparent):** https://www.cartavio.no/wp-content/uploads/2023/01/cartavio-logo-1000px-transparent.png

## Color Palette
*All values verified from live cartavio.no CSS, not estimated.*

### Primary brand colors
| Name | Hex | RGB | Source rule |
|---|---|---|---|
| Navy (primary) | `#002E6E` | rgb(0, 46, 110) | `#access li a`, heading color |
| Cyan (secondary) | `#00B8DE` | rgb(0, 184, 222) | `#header a`, site title |

### Derived tones (for app/UI use)
| Token | Hex | Use |
|---|---|---|
| Navy bright | `#1B4A9A` | Hover states on navy elements |
| Navy wash | `#e6ecf8` | Very light navy-tinted backgrounds |
| Cyan tint | `#e0f8ff` | Very light cyan backgrounds |
| Cyan line | `#7dd9f0` | Cyan borders/dividers |

### Neutral tones
| Token | Hex | Source |
|---|---|---|
| Background | `#ffffff` | `body { background-color: rgb(255,255,255) }` |
| Paper raised | `#f8f9fc` | Card/elevated surfaces (app-derived) |
| Paper sunken | `#f0f4f8` | Inset surfaces (app-derived) |
| Ink | `#111111` | `body { color: rgb(17,17,17) }` |
| Ink soft | `#374151` | Secondary text (app-derived) |
| Ink faint | `#6B7280` | Placeholder, labels (app-derived) |
| Line | `#d1d8e8` | Subtle dividers (app-derived) |
| Line strong | `#b0bcd4` | Visible borders (app-derived) |

### Supporting
| Token | Hex | Use |
|---|---|---|
| Gold | `#9a7b3f` | Starred/featured indicator |

## Typography
*Verified from live site computed styles.*

| Role | Font | Weight | Notes |
|---|---|---|---|
| Headings (h1–h4) | Open Sans Condensed | 300 (Light) | Elegant, distinctive |
| Body text | Ubuntu | 400 / 500 | Clean, readable |

**No DM Sans, no serif fonts, no warm editorial typefaces.**

## Design Aesthetic
- Pure white backgrounds (#ffffff) — not warm/sepia, not blue-gray
- Navy `#002E6E` as the dominant structural color (nav, headings)
- Cyan `#00B8DE` as the accent/link/highlight color
- Ubuntu body text at 16px / ~1.5 line-height
- Open Sans Condensed headings, weight 300 — light and elegant, not heavy
- Professional, clean, minimal — appropriate for an IT advisory firm
- Maritime/horizon hero imagery (expansive ocean sunset)

## What NOT to do
- No warm/sepia paper backgrounds (#f4f1ea style)
- No red, oxblood, or warm accent colors
- No DM Serif Display, Georgia, or serif heading fonts
- No DM Sans (this is not the brand font)
- No blue-gray backgrounds — the real background is pure white
- Don't use navy at 300-lightness — it should be dark `#002E6E`

## CSS Custom Properties (drop into :root)

```css
:root {
  --paper: #ffffff;
  --paper-raised: #f8f9fc;
  --paper-sunken: #f0f4f8;
  --ink: #111111;
  --ink-soft: #374151;
  --ink-faint: #6B7280;
  --line: #d1d8e8;
  --line-strong: #b0bcd4;

  --accent: #002E6E;
  --accent-bright: #1B4A9A;
  --accent-wash: #e6ecf8;

  --secondary-tint: #e0f8ff;
  --secondary-line: #7dd9f0;
  --secondary-ink: #00B8DE;       /* borders/washes/icons ONLY — 2.4:1 on white */
  --secondary-ink-text: #007696;  /* the TEXT-safe cyan (5.2:1) — all cyan text */

  /* Status pairs — every ink is >=4.5:1 on its wash and on white (WCAG AA) */
  --ok-ink: #1d7d49;   --ok-wash: #e8f7ef;
  --warn-ink: #8a5b00; --warn-wash: #fff7e6;
  --err-ink: #b91c1c;  --err-wash: #fef2f2;

  --gold: #9a7b3f;

  --shadow-sm: 0 1px 2px rgba(0,46,110,0.08);
  --shadow-md: 0 4px 16px rgba(0,46,110,0.12);
  --shadow-lg: 0 12px 40px rgba(0,46,110,0.18);

  --r-sm: 4px;
  --r-md: 7px;
  --r-lg: 12px;

  --serif: 'Open Sans Condensed', sans-serif;
  --sans: 'Ubuntu', -apple-system, sans-serif;
}

h1,h2,h3,h4 { font-family: var(--serif); font-weight: 300; line-height: 1.1; }
```

## Fonts

**Prefer self-hosting** (what Resume Studio does since v0.3.1): download the
woff2 files (Open Sans Condensed 300, Ubuntu 400/500, latin + latin-ext) to
`public/fonts/`, declare `@font-face` with `font-display: swap`, and preload
the two latin files. No third-party request (GDPR), works offline, and CSP
can stay `font-src 'self'`.

Quick-start alternative (prototypes only — it leaks visitor IPs to Google):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans+Condensed:wght@300&family=Ubuntu:wght@400;500&display=swap" rel="stylesheet">
```

## Application Steps (for a new project)

1. Add the fonts (self-hosted preferred, see above)
2. Add CSS custom properties to `:root` (above)
3. Set `h1,h2,h3,h4` to Open Sans Condensed 300
4. Update page `<title>` to reference Cartavio
5. Replace any warm/red accent usages with `var(--accent)` (navy #002E6E)
6. Use `var(--secondary-ink)` (#00B8DE) for highlight borders/washes/icons —
   but NEVER for text: it's 2.4:1 on white. Cyan-family **text** uses
   `var(--secondary-ink-text)` (#007696, WCAG AA)
7. Ensure backgrounds are pure white — not warm paper or blue-gray
8. Status colours (ok/warn/err) come as ink+wash pairs (above) — keep the
   pairs together so contrast stays AA
