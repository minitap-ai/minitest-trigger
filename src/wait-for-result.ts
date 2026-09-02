import * as core from '@actions/core'
import { getCiStatus, CiStatusError, type RunResult } from './api'

const POLL_INTERVAL_MS = 15_000

// A 4xx describes a request the server will never accept: an unregistered
// route on a testing-service too old to serve the gate, an app slug or tenant
// that does not resolve, a malformed SHA. Polling one of those to the end of
// the timeout reaches the same answer an hour later, so only the two codes
// that explicitly invite another attempt stay retryable.
const RETRYABLE_CLIENT_ERRORS = new Set([408, 429])

// A 401 is the one 4xx that says nothing about the request. The OIDC token is
// minted once, before the run is even triggered, and GitHub gives it roughly
// five minutes — while a suite routinely takes forty. So the poll that outlives
// the credential gets `unauthorized` and, treated as permanent, fails the gate
// on a run that was still healthy and would have passed. That is not
// theoretical: it blocked two consecutive production releases of the webapp,
// each ~5m03s and ~5m10s after the token was obtained.
//
// It is excluded here and handled in the loop instead, which re-mints and
// retries once. A 401 that survives a freshly minted token IS permanent — a
// wrong audience or a repo without id-token permission — and must not be
// polled for the full hour.
const UNAUTHORIZED = 401

function isPermanentFailure(err: unknown): err is CiStatusError {
  return (
    err instanceof CiStatusError &&
    err.statusCode >= 400 &&
    err.statusCode < 500 &&
    err.statusCode !== UNAUTHORIZED &&
    !RETRYABLE_CLIENT_ERRORS.has(err.statusCode)
  )
}

function isUnauthorized(err: unknown): err is CiStatusError {
  return err instanceof CiStatusError && err.statusCode === UNAUTHORIZED
}

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
  /**
   * Mints a NEW OIDC token. Called when the current one is rejected.
   *
   * Required because `token` is obtained before the run is triggered and is
   * shorter-lived than the wait: without a way to get another, `timeoutMs` can
   * never exceed the credential's ~5 minutes in practice.
   */
  refreshToken?: () => Promise<string>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll the run status until it reaches a verdict or the timeout elapses.
 *
 * Transient poll failures are swallowed and retried; a client error is fatal,
 * since retrying one can never succeed.
 */
export async function waitForVerdict(
  options: WaitForVerdictOptions,
): Promise<WaitOutcome> {
  const { apiUrl, appSlug, commitSha, tenantId, timeoutMs, refreshToken } =
    options
  const deadline = Date.now() + timeoutMs

  let token = options.token
  let lastState: string | undefined
  let lastUrl: string | null = null
  // Guards against a genuinely unauthorized setup polling for the full hour:
  // one re-mint is allowed per rejection, and a rejection of a token we just
  // minted is treated as the permanent failure it is.
  let tokenIsFresh = false

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
      // The token just worked, so the next rejection is an expiry rather than
      // a repeat of one we already failed to fix.
      tokenIsFresh = false

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
      if (isPermanentFailure(err)) {
        throw err
      }
      if (isUnauthorized(err)) {
        // Rejecting a token we minted moments ago is a real authorization
        // problem, not an expiry. Fail now rather than reporting it an hour
        // later as a timeout.
        if (tokenIsFresh || !refreshToken) {
          throw err
        }
        core.info('Run status token expired mid-wait, requesting a new one')
        token = await refreshToken()
        tokenIsFresh = true
        // Straight back round without sleeping: the wait is already
        // POLL_INTERVAL_MS behind and the new token is good now.
        continue
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
