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
export declare function resolvePrHeadSha(eventName: string | undefined): string | undefined;
