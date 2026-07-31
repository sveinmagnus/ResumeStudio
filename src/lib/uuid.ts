/**
 * The app's one id generator.
 *
 * This replaced the `uuid` package. Not because of the advisory that prompted
 * the look — that one is a missing bounds check in v3/v5/v6 when you pass your
 * own buffer, and nothing here has ever called anything but `v4()` with no
 * arguments — but because the dependency stopped earning its place: every
 * browser and Node version this app supports ships `crypto.randomUUID`, which
 * is the same 122 random bits from the same CSPRNG, with none of the supply
 * chain. A dependency you can delete is a dependency you don't have to audit.
 *
 * The fallback exists for exactly one case: `crypto.randomUUID` is only exposed
 * in SECURE contexts, so a build served over plain http from something other
 * than localhost has `crypto` but not `randomUUID`. That is a real way to run a
 * self-hosted app on a LAN, and it must not break id generation — so we build a
 * v4 out of `getRandomValues`, which has no such restriction.
 */

/** RFC 4122 version 4, from the platform CSPRNG. */
export function uuidv4(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()

  // Non-secure context: same entropy source, assembled by hand.
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    // No Web Crypto at all. Nothing here is a security token — these are
    // collision-avoidance ids for rows in one person's CV — so a weaker source
    // is far better than refusing to create an item.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10x

  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
