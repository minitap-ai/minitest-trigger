import { describe, expect, it } from 'vitest'
import { parseTargets, targetLabel } from './targets'

describe('parseTargets', () => {
  it('reads one target per line into the batch target shape', () => {
    expect(
      parseTargets(`
        platform=ios,os=26
        platform=ios,os=27.0,device=phone
        platform=android,device=tablet,os=15
        platform=ios,backend=physical,model=iPhone 13,os=26.1
        platform=web,browser=Chrome,version=157,viewport=desktop
        platform=web,browser=firefox,viewport=mobile
        platform=web
      `),
    ).toEqual([
      { platform: 'ios', osVersion: '26' },
      { platform: 'ios', osVersion: '27' },
      { platform: 'android', deviceType: 'tablet', osVersion: '15' },
      {
        platform: 'ios',
        backend: 'physical',
        deviceModels: ['iPhone 13'],
        osVersion: '26.1',
      },
      {
        platform: 'web',
        browser: 'chrome',
        browserVersionRequested: '157',
        viewport: 'pc',
      },
      { platform: 'web', browser: 'firefox', viewport: 'mobile' },
      { platform: 'web' },
    ])
  })

  it.each([
    ['os=26', '`platform` is required'],
    ['platform=windows', '`platform` must be "ios", "android", "web"'],
    ['platform=ios,colour=red', 'unknown key "colour"'],
    ['platform=ios,os=26,os=27', '`os` is set twice'],
    ['platform=ios,os=', '`os` needs a value'],
    ['platform=web,os=26', '`os` only applies to ios and android'],
    ['platform=ios,browser=chrome', '`browser` only applies to web'],
    ['platform=web,version=157', '`version` needs a `browser`'],
    [
      'platform=web,browser=chrome,version=157,viewport=mobile',
      '`version` is not available on a mobile screen',
    ],
    ['platform=ios,device=tv', '`device=tv` is only available on android'],
    ['platform=android,device=tv,os=14', '`os` is not available on a TV'],
    ['platform=ios,model=iPhone 13', '`model` needs `backend=physical`'],
    [
      'platform=ios,backend=physical,device=phone',
      '`device` only applies to cloud devices',
    ],
    [
      'platform=ios,backend=physical,os=26',
      '`os` on a physical device needs its `model`',
    ],
  ])('refuses "%s"', (line, reason) => {
    expect(() => parseTargets(line)).toThrow(reason)
  })

  it('refuses the same target twice, cloud being the default backend', () => {
    expect(() =>
      parseTargets(
        'platform=ios,os=27\nplatform=ios,backend=cloud,device=phone,os=27',
      ),
    ).toThrow('Target "iPhone · iOS 27" is listed twice')
  })
})

describe('targetLabel', () => {
  it.each([
    [{ platform: 'ios', osVersion: '27' }, 'iPhone · iOS 27'],
    [{ platform: 'ios', deviceType: 'tablet' }, 'iPad'],
    [
      { platform: 'android', deviceType: 'phone', osVersion: '15' },
      'Android phone · Android 15',
    ],
    [
      { platform: 'ios', backend: 'physical', deviceModels: ['iPhone 13'] },
      'iPhone 13',
    ],
    [
      {
        platform: 'web',
        browser: 'chrome',
        viewport: 'pc',
        browserVersion: '157.0.7000.1',
      },
      'Chrome 157 · Desktop',
    ],
    [{ platform: 'web', browser: 'edge', viewport: 'tablet' }, 'Edge · Tablet'],
    [{ platform: 'ios', browser: 'safari' }, 'Safari · iOS'],
  ] as const)('names %o "%s"', (target, label) => {
    expect(targetLabel(target)).toBe(label)
  })
})
