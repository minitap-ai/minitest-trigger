import * as core from '@actions/core'
import { getCiStatus, CiStatusError, type RunResult } from './api'

const POLL_INTERVAL_MS = 15_000

export interface VerdictReached {
  timedOut: false
  result: RunResult
  batchId: string | null
  url: string | null
  failedStories: string[]
}

export interface VerdictTimedOut {
  timedOut: true
  url: string | null
}

export type WaitOutcome = VerdictReached | VerdictTimedOut

export interface WaitForVerdictOptions {
  apiUrl: string
  token: string
  appSlug: string
  commitSha: string
  tenantId?: string
  timeoutMs: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll the run status until it reaches a verdict or the timeout elapses.
 *
 * Transient poll failures are swallowed and retried; only a broken
 * authorization is fatal, since retrying it can never succeed.
 */
export async function waitForVerdict(
  options: WaitForVerdictOptions,
): Promise<WaitOutcome> {
  const { apiUrl, token, appSlug, commitSha, tenantId, timeoutMs } = options
  const deadline = Date.now() + timeoutMs

  let lastState: string | undefined
  let lastUrl: string | null = null

  core.info(
    `Waiting for the run verdict, polling every ${POLL_INTERVAL_MS / 1000}s`,
  )

  while (Date.now() < deadline) {
    try {
      const status = await getCiStatus(apiUrl, token, {
        appSlug,
        commitSha,
        tenantId,
      })

      lastUrl = status.url ?? lastUrl

      if (status.state !== lastState) {
        lastState = status.state
        core.info(`Run state: ${status.state}`)
      }

      // A `completed` state without a result breaks the API contract — keep
      // polling instead of reporting a verdict we don't have.
      if (status.state === 'completed' && status.result) {
        return {
          timedOut: false,
          result: status.result,
          batchId: status.batchId,
          url: status.url,
          failedStories: status.failedStories ?? [],
        }
      }
    } catch (err) {
      if (
        err instanceof CiStatusError &&
        (err.statusCode === 401 || err.statusCode === 403)
      ) {
        throw err
      }
      core.debug(
        `Run status poll failed, retrying: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      break
    }
    await sleep(Math.min(POLL_INTERVAL_MS, remaining))
  }

  return { timedOut: true, url: lastUrl }
}
