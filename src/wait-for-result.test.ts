import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CiStatusError } from './api'
import { waitForVerdict } from './wait-for-result'

const POLL_INTERVAL_MS = 15_000

const http = vi.hoisted(() => ({
  queue: [] as Array<{ statusCode: number; body: string }>,
  requests: [] as string[],
}))

vi.mock('@actions/http-client', () => ({
  HttpClient: class {
    async get(url: string) {
      http.requests.push(url)
      const next = http.queue.shift() ?? {
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
    commitSha: 'deadbeef',
    timeoutMs: 60 * 60_000,
  })
}

beforeEach(() => {
  http.queue.length = 0
  http.requests.length = 0
  // The loop sleeps POLL_INTERVAL_MS between polls; real timers would make
  // every multi-poll case take 15s.
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForVerdict', () => {
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

  it.each([401, 403])(
    'aborts immediately on HTTP %i instead of retrying until the timeout',
    async (statusCode) => {
      http.queue.push(
        {
          statusCode,
          body: JSON.stringify({ error: 'unauthorized', message: 'nope' }),
        },
        COMPLETED,
      )

      await expect(wait()).rejects.toBeInstanceOf(CiStatusError)
      expect(http.requests).toHaveLength(1)
    },
  )
})
