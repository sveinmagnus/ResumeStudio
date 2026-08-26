import { describe, it, expect } from 'vitest'
import { socialSiteName } from '../src/lib/socialSite'

describe('socialSiteName — curated platforms', () => {
  it.each([
    ['https://x.com/someone', 'X'],
    ['https://twitter.com/someone', 'X'],
    ['https://www.instagram.com/someone/', 'Instagram'],
    ['https://de-de.facebook.com/someone', 'Facebook'],
    ['https://snapchat.com/add/someone', 'Snapchat'],
    ['https://pinterest.com/someone', 'Pinterest'],
    ['https://www.tiktok.com/@someone', 'TikTok'],
    ['https://youtu.be/abc', 'YouTube'],
    ['https://youtube.com/@channel', 'YouTube'],
    ['https://bsky.app/profile/someone', 'Bluesky'],
    ['https://mastodon.social/@someone', 'Mastodon'],
    ['https://github.com/someone', 'GitHub'],
    ['https://stackoverflow.com/users/1', 'Stack Overflow'],
    ['https://vk.com/someone', 'VK'],
    ['https://www.xing.com/profile/someone', 'Xing'],
    ['https://weibo.com/someone', 'Weibo'],
    ['https://weixin.qq.com/someone', 'WeChat'],
    ['https://line.me/ti/p/x', 'LINE'],
    ['https://t.me/someone', 'Telegram'],
    ['https://wa.me/4790000000', 'WhatsApp'],
    ['https://scholar.google.com/citations?user=x', 'Google Scholar'],
  ])('%s → %s', (url, name) => {
    expect(socialSiteName(url)).toBe(name)
  })

  it('reads a scheme-less host too — people paste those', () => {
    expect(socialSiteName('instagram.com/someone')).toBe('Instagram')
    expect(socialSiteName('www.threads.net/@someone')).toBe('Threads')
  })
})

describe('socialSiteName — the long tail', () => {
  it('derives a name from any other hostname', () => {
    expect(socialSiteName('https://fosstodon.org/@dev')).toBe('Fosstodon')
    expect(socialSiteName('https://dribbble.com/someone')).toBe('Dribbble')
    expect(socialSiteName('https://untappd.com/user/x')).toBe('Untappd')
  })

  it('skips a second-level public suffix rather than naming the site "Co"', () => {
    expect(socialSiteName('https://example.co.uk/me')).toBe('Example')
    expect(socialSiteName('https://myblog.ac.uk')).toBe('Myblog')
  })

  it('ignores subdomains on unknown hosts', () => {
    expect(socialSiteName('https://social.somesite.io/@me')).toBe('Somesite')
  })
})

describe('socialSiteName — values that name no site', () => {
  it.each([
    ['@handle'],
    ['plainhandle'],
    [''],
    ['   '],
    ['https://123.456/profile'],
  ])('%s → null', (value) => {
    expect(socialSiteName(value)).toBeNull()
  })
})
