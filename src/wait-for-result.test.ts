import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CiStatusError } from './api'
import { waitForVerdict } from './wait-for-result'

const POLL_INTERVAL_MS = 15_000

const http = vi.hoisted(() => ({
  queue: [] as Array<{ statusCode: number; body: string }>,
  requests: [] as string[],
  handler: undefined as
    ((url: string) => { statusCode: number; body: string }) | undefined,
}))

vi.mock('@actions/http-client', () => ({
  HttpClient: class {
    async get(url: string) {
      http.requests.push(url)
      const next = http.handler?.(url) ??
        http.queue.shift() ?? {
          statusCode: 403,
          body: JSON.stringify({
            error: 'test',
            message: 'unexpected extra poll',
          }),
        }
      return {
        message: { statusCode: next.statusCode },
        readBody: async () => next.body,
      }
    }
  },
}))

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

function status(body: Record<string, unknown>) {
  return { statusCode: 200, body: JSON.stringify(body) }
}

const COMPLETED = status({
  state: 'completed',
  result: 'passed',
  batchId: 'batch-1',
  appId: 'app-1',
  appSlug: 'demo',
  url: 'https://app.minitap.ai/runs/batch-1',
  failedStories: [],
})

function wait() {
  return waitForVerdict({
    apiUrl: 'https://api.example.com',
    token: 'token',
    appSlug: 'demo',
    batchId: 'batch-1',
    timeoutMs: 60 * 60_000,
  })
}

beforeEach(() => {
  http.queue.length = 0
  http.requests.length = 0
  http.handler = undefined
  // The loop sleeps POLL_INTERVAL_MS between polls; real timers would make
  // every multi-poll case take 15s.
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForVerdict', () => {
  it.each([
    ['phone', 'tablet'],
    ['tablet', 'phone'],
  ] as const)(
    'keeps same-commit verdicts separate when %s completes before %s',
    async (first, last) => {
      const results = { phone: 'passed', tablet: 'failed' } as const
      const completed = new Set<string>()
      let latest: 'phone' | 'tablet' = first
      http.handler = (url) => {
        const query = new URL(url).searchParams
        const selected = query.get('launch_intent_id')
        const device =
          selected === 'phone-intent'
            ? 'phone'
            : selected === 'tablet-intent'
              ? 'tablet'
              : latest
        const done = completed.has(device)
        return status({
          state: done ? 'completed' : 'pending',
          result: done ? results[device] : null,
          batchId: done ? `${device}-batch` : null,
          appId: 'app-1',
          appSlug: 'demo',
          url: done ? `https://app.minitap.ai/runs/${device}-batch` : null,
          failedStories: done && device === 'tablet' ? ['Tablet checkout'] : [],
        })
      }
      const launch = (device: 'phone' | 'tablet') =>
        waitForVerdict({
          apiUrl: 'https://api.example.com',
          token: 'token',
          appSlug: 'demo',
          launchIntentId: `${device}-intent`,
          timeoutMs: 60_000,
        })
      const outcomes = { phone: launch('phone'), tablet: launch('tablet') }

      completed.add(first)
      latest = first
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await expect(outcomes[first]).resolves.toMatchObject({
        result: results[first],
        batchId: `${first}-batch`,
      })

      completed.add(last)
      latest = last
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await expect(outcomes[last]).resolves.toMatchObject({
        result: results[last],
        batchId: `${last}-batch`,
      })
      expect(new Set(http.requests)).toEqual(
        new Set([
          'https://api.example.com/api/v1/ci/status?app_slug=demo&launch_intent_id=phone-intent',
          'https://api.example.com/api/v1/ci/status?app_slug=demo&launch_intent_id=tablet-intent',
        ]),
      )
    },
  )

  it('polls until the run completes, then returns that verdict', async () => {
    http.queue.push(
      status({
        state: 'running',
        result: null,
        batchId: 'batch-1',
        appId: 'app-1',
        appSlug: 'demo',
        url: 'https://app.minitap.ai/runs/batch-1',
        failedStories: [],
      }),
      COMPLETED,
    )

    const outcome = wait()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    await expect(outcome).resolves.toEqual({
      timedOut: false,
      result: 'passed',
      batchId: 'batch-1',
      url: 'https://app.minitap.ai/runs/batch-1',
      failedStories: [],
    })
    expect(http.requests).toHaveLength(2)
  })

  it('keeps polling through a transient server error instead of giving up', async () => {
    http.queue.push(
      {
        statusCode: 500,
        body: JSON.stringify({ error: 'internal', message: 'boom' }),
      },
      COMPLETED,
    )

    const outcome = wait()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    await expect(outcome).resolves.toMatchObject({
      timedOut: false,
      result: 'passed',
    })
    expect(http.requests).toHaveLength(2)
  })

  it.each([401, 403, 404, 409, 422])(
    'aborts immediately on HTTP %i instead of retrying until the timeout',
    async (statusCode) => {
      http.queue.push(
        {
          statusCode,
          body: JSON.stringify({ error: 'client', message: 'nope' }),
        },
        COMPLETED,
      )

      await expect(wait()).rejects.toBeInstanceOf(CiStatusError)
      expect(http.requests).toHaveLength(1)
    },
  )

  it.each([408, 429])(
    'keeps polling through HTTP %i, which invites another attempt',
    async (statusCode) => {
      http.queue.push(
        {
          statusCode,
          body: JSON.stringify({ error: 'retry', message: 'later' }),
        },
        COMPLETED,
      )

      const outcome = wait()
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      await expect(outcome).resolves.toMatchObject({
        timedOut: false,
        result: 'passed',
      })
      expect(http.requests).toHaveLength(2)
    },
  )
})

// ---------------------------------------------------------------------------
// The OIDC token outliving the wait
//
// The token is minted before the run is triggered and GitHub gives it about
// five minutes; a suite routinely takes forty. Treated as a permanent 4xx, the
// resulting 401 failed the gate on a healthy run — it blocked two consecutive
// production releases of the webapp, ~5m03s and ~5m10s after the token was
// obtained. These pin the recovery and its limit.
// ---------------------------------------------------------------------------

const RUNNING = status({
  state: 'running',
  result: null,
  batchId: 'batch-1',
  appId: 'app-1',
  appSlug: 'demo',
  url: 'https://app.minitap.ai/runs/batch-1',
  failedStories: [],
})

const UNAUTHORIZED = {
  statusCode: 401,
  body: JSON.stringify({
    error: 'unauthorized',
    message: 'GitHub OIDC token has expired (unauthorized)',
  }),
}

describe('waitForVerdict — expired OIDC token', () => {
  it('mints a new token and keeps waiting instead of failing the gate', async () => {
    http.queue.push(UNAUTHORIZED, COMPLETED)
    const refreshToken = vi.fn().mockResolvedValue('fresh-token')

    const outcome = waitForVerdict({
      apiUrl: 'https://api.example.com',
      token: 'expired-token',
      appSlug: 'demo',
      batchId: 'batch-1',
      timeoutMs: 60 * 60_000,
      refreshToken,
    })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    await expect(outcome).resolves.toMatchObject({
      timedOut: false,
      result: 'passed',
    })
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(http.requests[1]).toContain('batch_id=batch-1')
  })

  it('retries immediately rather than sleeping out another poll interval', async () => {
    http.queue.push(UNAUTHORIZED, COMPLETED)
    const refreshToken = vi.fn().mockResolvedValue('fresh-token')

    const outcome = waitForVerdict({
      apiUrl: 'https://api.example.com',
      token: 'expired-token',
      appSlug: 'demo',
      batchId: 'batch-1',
      timeoutMs: 60 * 60_000,
      refreshToken,
    })
    // No timer advance at all: the refresh path must not wait.
    await expect(outcome).resolves.toMatchObject({ result: 'passed' })
  })

  it('fails fast when a freshly minted token is also refused', async () => {
    // A wrong audience, or a workflow without `id-token: write`. Polling that
    // for the full hour reports a timeout instead of the real cause.
    http.queue.push(UNAUTHORIZED, UNAUTHORIZED)
    const refreshToken = vi.fn().mockResolvedValue('still-bad')

    const outcome = waitForVerdict({
      apiUrl: 'https://api.example.com',
      token: 'expired-token',
      appSlug: 'demo',
      batchId: 'batch-1',
      timeoutMs: 60 * 60_000,
      refreshToken,
    })

    await expect(outcome).rejects.toBeInstanceOf(CiStatusError)
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('still fails on 401 when no refresh is available', async () => {
    http.queue.push(UNAUTHORIZED)

    await expect(wait()).rejects.toBeInstanceOf(CiStatusError)
  })

  it('allows a second refresh after a poll succeeds in between', async () => {
    // A wait long enough to outlive two tokens must survive both, so the
    // one-shot guard has to reset on every successful poll.
    http.queue.push(UNAUTHORIZED, RUNNING, UNAUTHORIZED, COMPLETED)
    const refreshToken = vi.fn().mockResolvedValue('fresh-token')

    const outcome = waitForVerdict({
      apiUrl: 'https://api.example.com',
      token: 'expired-token',
      appSlug: 'demo',
      batchId: 'batch-1',
      timeoutMs: 60 * 60_000,
      refreshToken,
    })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

    await expect(outcome).resolves.toMatchObject({ result: 'passed' })
    expect(refreshToken).toHaveBeenCalledTimes(2)
  })
})
