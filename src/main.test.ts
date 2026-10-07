import { readFileSync } from 'node:fs'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as core from '@actions/core'
import { HttpClient, HttpClientResponse } from '@actions/http-client'

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  getIDToken: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))

const manifest = readFileSync(new URL('../action.yml', import.meta.url), 'utf8')
const inputs = manifest.split('inputs:\n')[1].split('\noutputs:')[0]
const inputBlocks = new Map(
  [...inputs.matchAll(/^ {2}([\w-]+):\n((?: {4}.*\n)*)/gm)].map((match) => [
    match[1],
    match[2],
  ]),
)

function input(name: string, value: string): void {
  vi.stubEnv(`INPUT_${name.toUpperCase()}`, value)
}

function response(
  body: Record<string, unknown>,
  statusCode = 200,
): HttpClientResponse {
  const result = new HttpClientResponse(new IncomingMessage(new Socket()))
  result.message.statusCode = statusCode
  vi.spyOn(result, 'readBody').mockResolvedValue(JSON.stringify(body))
  return result
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  // The GitHub runner supplies manifest defaults before core reads the inputs.
  for (const [name, block] of inputBlocks) {
    input(name, block.match(/^ {4}default: '([^']*)'/m)?.[1] ?? '')
  }
  input('app-slug', 'my-app')
  input('commit-title', 'Test native form factors')
  vi.stubEnv('GITHUB_EVENT_NAME', 'push')
  vi.stubEnv('GITHUB_EVENT_PATH', '')
  vi.stubEnv('GITHUB_REF', 'refs/tags/v1.0.0')
  vi.mocked(core.getIDToken).mockResolvedValue(
    `header.${Buffer.from(JSON.stringify({ sha: 'commit-sha' })).toString('base64url')}.signature`,
  )

  const response = new HttpClientResponse(new IncomingMessage(new Socket()))
  response.message.statusCode = 200
  vi.spyOn(response, 'readBody').mockResolvedValue(
    JSON.stringify({
      batchId: 'batch-1',
      status: 'pending',
      appId: 'app-1',
      appSlug: 'my-app',
    }),
  )
  vi.spyOn(HttpClient.prototype, 'request').mockResolvedValue(response)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function runAction(): Promise<void> {
  await import('./main')
  await vi.waitFor(() => {
    expect(
      vi.mocked(core.setOutput).mock.calls.filter(([name]) => name === 'result')
        .length + vi.mocked(core.setFailed).mock.calls.length,
    ).toBeGreaterThan(0)
  })
}

function sentRequest(): Record<string, unknown> {
  const calls = vi.mocked(HttpClient.prototype.request).mock.calls
  expect(calls).toHaveLength(1)
  const [method, url, body, headers] = calls[0]
  expect(method).toBe('POST')
  expect(url).toBe('https://testing-service.app.minitap.ai/api/v1/ci/run')
  expect(headers?.['Content-Type']).toBe('application/json')
  expect(typeof body).toBe('string')
  return JSON.parse(body as string)
}

describe('native device-type inputs through the action and real API serializer', () => {
  it('declares optional inputs without manifest defaults', () => {
    for (const name of ['ios-device-type', 'android-device-type']) {
      expect(inputBlocks.get(name)).toContain('required: false')
      expect(inputBlocks.get(name)).not.toContain('default:')
    }
  })

  it('keeps the complete legacy default wire payload when types are omitted', async () => {
    await runAction()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(sentRequest()).toEqual({
      appSlug: 'my-app',
      commitTitle: 'Test native form factors',
      commitSha: 'commit-sha',
      cancelPreviousRuns: true,
    })
    expect(core.setOutput).toHaveBeenCalledWith('batch-id', 'batch-1')
  })

  it.each(['phone', 'tablet'])(
    'forwards explicit %s for both native lanes',
    async (deviceType) => {
      input('ios-device-type', deviceType)
      input('android-device-type', deviceType)
      await runAction()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(sentRequest()).toEqual({
        appSlug: 'my-app',
        commitTitle: 'Test native form factors',
        commitSha: 'commit-sha',
        cancelPreviousRuns: true,
        iosDeviceType: deviceType,
        androidDeviceType: deviceType,
      })
    },
  )

  it.each(['ios', 'android'])(
    'configures only the selected %s lane, with web still additive',
    async (platform) => {
      const other = platform === 'ios' ? 'android' : 'ios'
      input(`run-${other}`, 'false')
      input(`${platform}-device-type`, 'tablet')
      input('web-targets', 'chrome:desktop')
      await runAction()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(sentRequest()).toEqual({
        appSlug: 'my-app',
        commitTitle: 'Test native form factors',
        commitSha: 'commit-sha',
        cancelPreviousRuns: true,
        platforms: [platform, 'web'],
        [`${platform}DeviceType`]: 'tablet',
        webTargets: [{ platform: 'web', browser: 'chrome', viewport: 'pc' }],
      })
    },
  )

  it('leaves the other native lane on its omitted phone behavior', async () => {
    input('ios-device-type', 'tablet')
    await runAction()

    expect(sentRequest().iosDeviceType).toBe('tablet')
    expect(sentRequest()).not.toHaveProperty('androidDeviceType')
    expect(sentRequest()).not.toHaveProperty('platforms')
  })

  it('preserves web-only requests without native device types', async () => {
    input('run-ios', 'false')
    input('run-android', 'false')
    input('web-targets', 'chrome:tablet')
    await runAction()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(sentRequest()).toEqual({
      appSlug: 'my-app',
      commitTitle: 'Test native form factors',
      commitSha: 'commit-sha',
      cancelPreviousRuns: true,
      platforms: ['web'],
      webTargets: [{ platform: 'web', browser: 'chrome', viewport: 'tablet' }],
    })
  })

  for (const platform of ['ios', 'android']) {
    it.each(['phone', 'tablet'])(
      `rejects explicit %s on disabled ${platform} before any network call`,
      async (deviceType) => {
        input(`run-${platform}`, 'false')
        input(`${platform}-device-type`, deviceType)
        vi.stubEnv('GITHUB_EVENT_NAME', 'issue_comment')
        await runAction()

        expect(core.setFailed).toHaveBeenCalledWith(
          expect.stringContaining(
            `\`${platform}-device-type\` was provided but \`run-${platform}\` is false`,
          ),
        )
        expect(core.getIDToken).not.toHaveBeenCalled()
        expect(HttpClient.prototype.request).not.toHaveBeenCalled()
      },
    )

    it.each(['phone,tablet'])(
      `rejects invalid ${platform} enum %s`,
      async (deviceType) => {
        input(`${platform}-device-type`, deviceType)
        await runAction()

        expect(core.setFailed).toHaveBeenCalledWith(
          `\`${platform}-device-type\` must be "phone" or "tablet" (got "${deviceType}").`,
        )
        expect(core.getIDToken).not.toHaveBeenCalled()
        expect(HttpClient.prototype.request).not.toHaveBeenCalled()
      },
    )
  }

  it('does not use a device type to select an OS when all lanes are off', async () => {
    input('run-ios', 'false')
    input('run-android', 'false')
    input('android-device-type', 'tablet')
    await runAction()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        '`android-device-type` was provided but `run-android` is false',
      ),
    )
    expect(HttpClient.prototype.request).not.toHaveBeenCalled()
  })
})

describe('waiting for the exact launched run', () => {
  const status = (batchId: string, result: 'passed' | 'failed') => ({
    state: 'completed',
    result,
    batchId,
    appId: 'app-1',
    appSlug: 'my-app',
    url: `https://app.minitap.ai/runs/${batchId}`,
    failedStories: result === 'failed' ? ['Tablet checkout'] : [],
  })

  it.each([
    {
      field: 'warnings',
      message:
        'This iPhone-only build may run on iPad in compatibility mode; the run does not establish native tablet-layout coverage.',
    },
    {
      field: 'compatibilityWarnings',
      message:
        'iPad support is unknown for this build; the run does not establish native tablet-layout coverage.',
    },
  ])(
    'surfaces nonblocking compatibility notices from $field without changing the verdict',
    async ({ field, message }) => {
      input('wait-for-result', 'true')
      input('fail-on-failure', 'true')
      input('ios-device-type', 'tablet')
      vi.mocked(HttpClient.prototype.request).mockImplementation(
        async (method) =>
          method === 'POST'
            ? response({
                batchId: 'tablet-batch',
                status: 'pending',
                appId: 'app-1',
                appSlug: 'my-app',
                [field]: [message],
              })
            : response(status('tablet-batch', 'passed')),
      )

      await runAction()

      expect(core.warning).toHaveBeenCalledWith(message, { title: 'Minitest' })
      expect(core.setOutput).toHaveBeenCalledWith('result', 'passed')
      expect(core.setOutput).toHaveBeenCalledWith('batch-id', 'tablet-batch')
      expect(core.setFailed).not.toHaveBeenCalled()
    },
  )

  it.each([
    { deviceType: 'tablet', ownVerdict: 'failed', otherVerdict: 'passed' },
    { deviceType: 'phone', ownVerdict: 'passed', otherVerdict: 'failed' },
  ] as const)(
    'reports its $deviceType verdict, not the other run on the same commit',
    async ({ deviceType, ownVerdict, otherVerdict }) => {
      input('wait-for-result', 'true')
      input('fail-on-failure', 'true')
      input('ios-device-type', deviceType)
      const ownBatchId = `${deviceType}-batch`
      vi.mocked(HttpClient.prototype.request).mockImplementation(
        async (method, url, body) => {
          if (method === 'POST') {
            expect(JSON.parse(body as string)).toMatchObject({
              commitSha: 'commit-sha',
              iosDeviceType: deviceType,
            })
            return response({
              batchId: ownBatchId,
              maintenanceRunId: 'shared-analysis',
              launchIntentId: `${deviceType}-intent`,
              status: 'pending',
              appId: 'app-1',
              appSlug: 'my-app',
            })
          }
          const query = new URL(url).searchParams
          return response(
            query.get('batch_id') === ownBatchId
              ? status(ownBatchId, ownVerdict)
              : status('other-batch-same-commit', otherVerdict),
          )
        },
      )

      await runAction()

      expect(core.setOutput).toHaveBeenCalledWith('result', ownVerdict)
      expect(core.setOutput).toHaveBeenCalledWith('batch-id', ownBatchId)
      expect(core.setOutput).toHaveBeenCalledWith(
        'batch-url',
        `https://app.minitap.ai/runs/${ownBatchId}`,
      )
      expect(
        vi
          .mocked(HttpClient.prototype.request)
          .mock.calls.map(([method, url]) => [method, url]),
      ).toEqual([
        ['POST', 'https://testing-service.app.minitap.ai/api/v1/ci/run'],
        [
          'GET',
          `https://testing-service.app.minitap.ai/api/v1/ci/status?app_slug=my-app&batch_id=${ownBatchId}`,
        ],
      ])
      if (ownVerdict === 'failed')
        expect(core.setFailed).toHaveBeenCalledWith(
          expect.stringContaining('Tablet checkout'),
        )
      else expect(core.setFailed).not.toHaveBeenCalled()
    },
  )

  it('follows its opaque deferred handle through analysis to its own batch', async () => {
    vi.useFakeTimers()
    input('wait-for-result', 'true')
    input('fail-on-failure', 'true')
    input('ios-device-type', 'tablet')
    let polls = 0
    vi.mocked(HttpClient.prototype.request).mockImplementation(
      async (method, url) => {
        if (method === 'POST')
          return response({
            batchId: null,
            maintenanceRunId: 'shared-analysis',
            launchIntentId: 'tablet-intent',
            status: 'pending',
            appId: 'app-1',
            appSlug: 'my-app',
          })
        if (
          new URL(url).searchParams.get('launch_intent_id') !== 'tablet-intent'
        )
          return response(status('phone-batch-same-commit', 'passed'))
        polls += 1
        return response(
          polls === 1
            ? {
                state: 'pending',
                result: null,
                batchId: null,
                url: null,
                appId: 'app-1',
                appSlug: 'my-app',
                failedStories: [],
              }
            : status('tablet-batch', 'failed'),
        )
      },
    )

    await import('./main')
    await vi.advanceTimersByTimeAsync(15_000)

    expect(core.setOutput).toHaveBeenCalledWith('result', 'failed')
    expect(core.setOutput).toHaveBeenCalledWith('batch-id', 'tablet-batch')
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Tablet checkout'),
    )
    const pollUrls = vi
      .mocked(HttpClient.prototype.request)
      .mock.calls.filter(([method]) => method === 'GET')
      .map(([, url]) => url)
    expect(pollUrls).toEqual(
      Array(2).fill(
        'https://testing-service.app.minitap.ai/api/v1/ci/status?app_slug=my-app&launch_intent_id=tablet-intent',
      ),
    )
  })

  it('returns a confirmed nothing-affected no-op without polling another run', async () => {
    input('wait-for-result', 'true')
    input('fail-on-failure', 'true')
    vi.mocked(HttpClient.prototype.request).mockResolvedValue(
      response({
        batchId: null,
        maintenanceRunId: null,
        launchIntentId: null,
        status: 'pending',
        appId: 'app-1',
        appSlug: 'my-app',
        warnings: ['nothing_affected'],
      }),
    )

    await runAction()

    expect(core.setOutput).toHaveBeenCalledWith('result', 'nothing_affected')
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(
      vi
        .mocked(HttpClient.prototype.request)
        .mock.calls.map(([method]) => method),
    ).toEqual(['POST'])
  })

  it('reports an unavailable verdict for analysis-only progress without a launch handle', async () => {
    input('wait-for-result', 'true')
    vi.mocked(HttpClient.prototype.request).mockResolvedValue(
      response({
        batchId: null,
        maintenanceRunId: 'shared-analysis',
        status: 'pending',
        appId: 'app-1',
        appSlug: 'my-app',
      }),
    )

    await runAction()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Run verdict unavailable'),
    )
    expect(core.setOutput).toHaveBeenCalledWith('result', '')
    expect(
      vi
        .mocked(HttpClient.prototype.request)
        .mock.calls.map(([method]) => method),
    ).toEqual(['POST'])
  })

  it('never retries an unsupported exact selector with a latest-commit selector', async () => {
    input('wait-for-result', 'true')
    vi.mocked(HttpClient.prototype.request).mockImplementation(
      async (method) =>
        method === 'POST'
          ? response({
              batchId: 'tablet-batch',
              status: 'pending',
              appId: 'app-1',
              appSlug: 'my-app',
            })
          : response(
              { detail: 'commit_sha is required by this older server' },
              422,
            ),
    )

    await runAction()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('422'))
    expect(
      vi
        .mocked(HttpClient.prototype.request)
        .mock.calls.map(([method, url]) => [method, url]),
    ).toEqual([
      ['POST', 'https://testing-service.app.minitap.ai/api/v1/ci/run'],
      [
        'GET',
        'https://testing-service.app.minitap.ai/api/v1/ci/status?app_slug=my-app&batch_id=tablet-batch',
      ],
    ])
  })

  it('refuses a status response for another batch even when the server ignores the selector', async () => {
    input('wait-for-result', 'true')
    vi.mocked(HttpClient.prototype.request).mockImplementation(
      async (method) =>
        method === 'POST'
          ? response({
              batchId: 'tablet-batch',
              status: 'pending',
              appId: 'app-1',
              appSlug: 'my-app',
            })
          : response(status('phone-batch-same-commit', 'passed')),
    )

    await runAction()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('does not match the requested batch'),
    )
    expect(core.setOutput).not.toHaveBeenCalledWith('result', 'passed')
    expect(
      vi
        .mocked(HttpClient.prototype.request)
        .mock.calls.map(([method]) => method),
    ).toEqual(['POST', 'GET'])
  })
})
