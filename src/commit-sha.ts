import * as fs from 'fs'
import * as core from '@actions/core'

/**
 * For `pull_request` and `pull_request_target` workflow events, GitHub's
 * OIDC token `sha` claim (and `GITHUB_SHA`) refer to the ephemeral
 * test-merge commit on `refs/pull/{n}/merge`, NOT the PR's actual head
 * commit. That merge commit is not part of the PR's commit history, so
 * any GitHub Check Run anchored to it cannot be resolved by the PR
 * "Checks" tab — GitHub returns "No check run found with ID <id> for
 * this pull request" when the user clicks the check.
 *
 * For PR events, return the real PR head SHA from the workflow's event
 * payload (`pull_request.head.sha`). For all other events, return
 * `undefined` to signal that the OIDC `sha` claim should be used as-is.
 *
 * Returns `undefined` (NOT throws) on any failure so callers can fall
 * back to the OIDC claim — losing the override is preferable to
 * crashing the action.
 */
export function resolvePrHeadSha(
  eventName: string | undefined,
): string | undefined {
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
    return undefined
  }

  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    core.warning(
      'GITHUB_EVENT_PATH is unset on a pull_request event — falling back to OIDC sha (may not match PR head)',
    )
    return undefined
  }

  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'))
    const headSha = event?.pull_request?.head?.sha
    if (typeof headSha === 'string' && /^[0-9a-f]{40}$/.test(headSha)) {
      return headSha
    }
    core.warning(
      'pull_request.head.sha missing or malformed in event payload — falling back to OIDC sha',
    )
    return undefined
  } catch (err) {
    core.warning(
      `Failed to read GitHub event payload for PR head sha: ${err instanceof Error ? err.message : String(err)}`,
    )
    return undefined
  }
}
