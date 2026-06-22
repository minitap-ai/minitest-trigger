import type { WebTargetSpec } from './api'

/** Parse comma-separated `<browser>:<viewport>` web-target tokens into `WebTargetSpec[]`. */
export function parseWebTargets(raw: string): WebTargetSpec[] {
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  return tokens.map(parseWebTargetToken)
}

function parseWebTargetToken(token: string): WebTargetSpec {
  const parts = token.split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid web target "${token}".\n` +
        '  Expected `<browser>:<viewport>`, e.g. `chrome:desktop` or `safari:mobile`.',
    )
  }

  const browser = parts[0].trim().toLowerCase()
  const viewport = parts[1].trim().toLowerCase()

  if (browser === 'safari' && viewport === 'mobile') {
    return { platform: 'ios', browser: 'safari' }
  }
  if (browser === 'chrome' && viewport === 'mobile') {
    return { platform: 'android', browser: 'chrome' }
  }
  if (browser === 'chrome' || browser === 'firefox') {
    if (viewport === 'tablet') {
      return { platform: 'web', browser, viewport: 'tablet' }
    }
    if (viewport === 'desktop') {
      return { platform: 'web', browser, viewport: 'pc' }
    }
  }

  throw new Error(
    `Unsupported web target "${token}".\n` +
      '  Valid targets: `chrome:desktop`, `firefox:desktop`, `chrome:tablet`, `firefox:tablet`, `chrome:mobile` (Android), `safari:mobile` (iOS).',
  )
}
