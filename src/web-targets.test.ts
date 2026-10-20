import { describe, expect, it } from 'vitest'
import { parseWebTargets } from './web-targets'

describe('parseWebTargets', () => {
  it('maps Edge tablet and desktop to browser-web targets', () => {
    expect(parseWebTargets('edge:tablet, EDGE:Desktop')).toEqual([
      { platform: 'web', browser: 'edge', viewport: 'tablet' },
      { platform: 'web', browser: 'edge', viewport: 'pc' },
    ])
  })

  it.each(['edge:mobile', 'safari:desktop', 'firefox:mobile'])(
    'rejects %s and lists the Edge targets among the valid ones',
    (token) => {
      expect(() => parseWebTargets(token)).toThrow(
        /Unsupported web target[\s\S]*`edge:desktop`[\s\S]*`edge:tablet`/,
      )
    },
  )
})
