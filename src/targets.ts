import type { Platform, RunTarget } from './api'

const KEYS = [
  'platform',
  'backend',
  'device',
  'model',
  'os',
  'browser',
  'version',
  'viewport',
] as const
type Key = (typeof KEYS)[number]

const CHOICES: Partial<Record<Key, readonly string[]>> = {
  platform: ['ios', 'android', 'web'],
  backend: ['cloud', 'physical'],
  device: ['phone', 'tablet', 'tv'],
  browser: ['chrome', 'edge', 'firefox'],
  viewport: ['desktop', 'tablet', 'mobile'],
}

const VIEWPORT_WIRE = {
  desktop: 'pc',
  tablet: 'tablet',
  mobile: 'mobile',
} as const

/** Parse the `targets` input: one target per line, each a comma-separated list of key=value pairs. */
export function parseTargets(raw: string): RunTarget[] {
  const targets = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseTargetLine)
  const seen = new Set<string>()
  for (const target of targets) {
    const key = JSON.stringify([
      target.platform,
      target.backend ?? 'cloud',
      target.deviceType ?? null,
      target.deviceModels?.[0] ?? null,
      target.osVersion ?? null,
      target.browser ?? null,
      target.browserVersionRequested ?? null,
      target.viewport ?? null,
    ])
    if (seen.has(key)) {
      throw new Error(
        `Target "${targetLabel(target)}" is listed twice in \`targets\`.`,
      )
    }
    seen.add(key)
  }
  return targets
}

export function parseTargetLine(line: string): RunTarget {
  const fields = new Map<Key, string>()
  for (const pair of line.split(',')) {
    const [rawKey, ...rest] = pair.split('=')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join('=').trim()
    if (!(KEYS as readonly string[]).includes(key)) {
      throw invalid(
        line,
        `unknown key "${key}"; use ${KEYS.map((k) => `\`${k}\``).join(', ')}`,
      )
    }
    if (!value) throw invalid(line, `\`${key}\` needs a value`)
    if (fields.has(key as Key)) throw invalid(line, `\`${key}\` is set twice`)
    const choices = CHOICES[key as Key]
    const normalized = choices ? value.toLowerCase() : value
    if (choices && !choices.includes(normalized)) {
      throw invalid(
        line,
        `\`${key}\` must be ${choices.map((c) => `"${c}"`).join(', ')} (got "${value}")`,
      )
    }
    fields.set(key as Key, normalized)
  }
  return toTarget(line, fields)
}

function toTarget(line: string, fields: Map<Key, string>): RunTarget {
  const platform = fields.get('platform') as Platform | undefined
  if (!platform) throw invalid(line, '`platform` is required')
  const backend = fields.get('backend') ?? 'cloud'
  const device = fields.get('device')
  const model = fields.get('model')
  const rawOs = fields.get('os')
  const os = backend === 'physical' ? rawOs : rawOs?.split('.')[0]
  const browser = fields.get('browser')
  const version = fields.get('version')
  const viewport = fields.get('viewport') as
    keyof typeof VIEWPORT_WIRE | undefined

  if (platform === 'web') {
    for (const key of ['backend', 'device', 'model', 'os'] as const) {
      if (fields.has(key)) {
        throw invalid(line, `\`${key}\` only applies to ios and android`)
      }
    }
    if (version && !browser) {
      throw invalid(line, '`version` needs a `browser`')
    }
    if (version && viewport === 'mobile') {
      throw invalid(
        line,
        '`version` is not available on a mobile screen, whose browser follows the device',
      )
    }
    return {
      platform,
      ...(browser && { browser: browser as RunTarget['browser'] }),
      ...(version && { browserVersionRequested: version }),
      ...(viewport && { viewport: VIEWPORT_WIRE[viewport] }),
    }
  }

  for (const key of ['browser', 'version', 'viewport'] as const) {
    if (fields.has(key)) throw invalid(line, `\`${key}\` only applies to web`)
  }
  if (device === 'tv' && platform !== 'android') {
    throw invalid(line, '`device=tv` is only available on android')
  }
  if (device === 'tv' && os) {
    throw invalid(line, '`os` is not available on a TV')
  }
  if (backend === 'physical' && device) {
    throw invalid(
      line,
      '`device` only applies to cloud devices; a physical target is its `model`',
    )
  }
  if (model && backend !== 'physical') {
    throw invalid(line, '`model` needs `backend=physical`')
  }
  if (backend === 'physical' && os && !model) {
    throw invalid(line, '`os` on a physical device needs its `model`')
  }
  return {
    platform,
    ...(backend === 'physical' && { backend: 'physical' as const }),
    ...(device &&
      device !== 'phone' && { deviceType: device as RunTarget['deviceType'] }),
    ...(model && { deviceModels: [model] }),
    ...(os && { osVersion: os }),
  }
}

function invalid(line: string, reason: string): Error {
  return new Error(
    `Invalid target "${line}": ${reason}.\n` +
      '  Each line of `targets` is a comma-separated list of key=value pairs, e.g. `platform=ios,os=27` or `platform=web,browser=chrome,version=157,viewport=desktop`.',
  )
}

const BROWSER_NAMES: Record<string, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
}
const VIEWPORT_NAMES: Record<string, string> = {
  pc: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
}

export interface LabelledTarget {
  platform: Platform
  backend?: string | null
  deviceType?: string | null
  deviceModels?: string[] | null
  osVersion?: string | null
  browser?: string | null
  browserVersionRequested?: string | null
  browserVersion?: string | null
  viewport?: string | null
}

/** The webapp's name for a target: "iPhone · iOS 27", "Chrome 157 · Desktop". */
export function targetLabel(target: LabelledTarget): string {
  if (target.platform === 'web' || target.browser) {
    if (!target.browser) return 'Web (app defaults)'
    const version = (
      target.browserVersion ?? target.browserVersionRequested
    )?.split('.')[0]
    const name = BROWSER_NAMES[target.browser] ?? target.browser
    const browser = version ? `${name} ${version}` : name
    const screen =
      target.platform === 'web'
        ? VIEWPORT_NAMES[target.viewport ?? 'pc']
        : target.platform === 'ios'
          ? 'iOS'
          : 'Android'
    return `${browser} · ${screen}`
  }
  const model =
    target.deviceModels?.length === 1
      ? target.deviceModels[0]
      : formFactor(target.platform, target.deviceType)
  const osName = target.platform === 'ios' ? 'iOS' : 'Android'
  return target.osVersion ? `${model} · ${osName} ${target.osVersion}` : model
}

function formFactor(platform: Platform, deviceType?: string | null): string {
  if (platform === 'ios') return deviceType === 'tablet' ? 'iPad' : 'iPhone'
  if (deviceType === 'tv') return 'Android TV'
  return deviceType === 'tablet' ? 'Android tablet' : 'Android phone'
}
