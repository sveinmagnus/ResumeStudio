/**
 * PURE: name the social platform a URL points at.
 *
 * The "Other social media" slot (`Resume.twitter`, historically Twitter/X)
 * holds ANY profile link, and a CV header reading "Social media:
 * https://instagram.com/…" says the obvious twice. This derives the proper
 * site name from the URL so the label can say "Instagram: " instead — and the
 * JSON Resume exporter can emit a truthful `network`.
 *
 * Two tiers, so it works for almost any site rather than a fixed ten:
 *  - a curated map for platforms whose NAME isn't their domain (X, YouTube via
 *    youtu.be, Telegram via t.me, WeChat via weixin.qq.com …) — brand names,
 *    identical in every locale, which is why this module takes no locale;
 *  - a generic fallback that capitalises the registrable label of any other
 *    hostname ("fosstodon.org" → "Fosstodon"), covering the long tail of
 *    federated and niche platforms without a list to maintain.
 *
 * A value that isn't URL-shaped (a bare @handle) is null — the caller keeps
 * its localized generic label; a handle names no site.
 */

import { lookup } from './lookup'

/**
 * Registrable-domain → proper name, for names the fallback can't derive.
 * Keyed WITHOUT subdomains ("de-de.facebook.com" resolves via "facebook.com").
 * Domains whose SLD capitalises to the right name (instagram.com, snapchat.com,
 * pinterest.de, dribbble.com …) don't need a row — the fallback handles them —
 * but the household names are listed anyway so a future rename or an odd TLD
 * can't silently change what a CV prints.
 */
const KNOWN_SITES: Record<string, string> = {
  'twitter.com': 'X',
  'x.com': 'X',
  'instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
  'fb.me': 'Facebook',
  'snapchat.com': 'Snapchat',
  'pinterest.com': 'Pinterest',
  'tiktok.com': 'TikTok',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'threads.net': 'Threads',
  'bsky.app': 'Bluesky',
  'mastodon.social': 'Mastodon',
  'reddit.com': 'Reddit',
  'twitch.tv': 'Twitch',
  'medium.com': 'Medium',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'stackoverflow.com': 'Stack Overflow',
  'linkedin.com': 'LinkedIn',
  'xing.com': 'Xing',
  'vk.com': 'VK',
  'weibo.com': 'Weibo',
  'weixin.qq.com': 'WeChat',
  'line.me': 'LINE',
  't.me': 'Telegram',
  'telegram.me': 'Telegram',
  'wa.me': 'WhatsApp',
  'whatsapp.com': 'WhatsApp',
  'discord.gg': 'Discord',
  'discord.com': 'Discord',
  'vimeo.com': 'Vimeo',
  'behance.net': 'Behance',
  'flickr.com': 'Flickr',
  'tumblr.com': 'Tumblr',
  'kakao.com': 'KakaoTalk',
  'orcid.org': 'ORCID',
  'researchgate.net': 'ResearchGate',
  'scholar.google.com': 'Google Scholar',
}

/**
 * Second-level labels that are public suffixes, not sites ("example.co.uk"
 * is Example, not Co). The short pragmatic set — a full public-suffix list is
 * a dependency this feature doesn't earn.
 */
const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/** The hostname of a value that is (or can be read as) a URL, else null. */
function hostnameOf(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? [v] : v.includes('.') ? [`https://${v}`] : []
  for (const c of candidates) {
    try {
      const host = new URL(c).hostname.toLowerCase()
      if (host.includes('.')) return host.replace(/^www\./, '')
    } catch { /* not a URL — fall through */ }
  }
  return null
}

/** "de-de.facebook.com" → "facebook.com"; "example.co.uk" → "example.co.uk". */
function registrableDomain(host: string): string {
  const labels = host.split('.').filter(Boolean)
  if (labels.length <= 2) return host
  const takeThree = SECOND_LEVEL_SUFFIXES.has(labels[labels.length - 2])
  return labels.slice(takeThree ? -3 : -2).join('.')
}

/**
 * The proper display name of the platform `value` links to, or null when the
 * value names no site (a bare handle, empty, unparseable). Unknown-but-real
 * hosts get their registrable label capitalised — good enough that the long
 * tail never falls back to a generic "Social media".
 */
export function socialSiteName(value: string): string | null {
  const host = hostnameOf(value)
  if (!host) return null

  const domain = registrableDomain(host)
  // Subdomain-carrying map keys (scholar.google.com, weixin.qq.com) match on
  // the full host first; everything else on the registrable domain.
  const known = lookup(KNOWN_SITES, host, '') || lookup(KNOWN_SITES, domain, '')
  if (known) return known

  const site = domain.split('.')[0]
  if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(site) || !/[a-z]/.test(site)) return null
  return site.charAt(0).toUpperCase() + site.slice(1)
}
