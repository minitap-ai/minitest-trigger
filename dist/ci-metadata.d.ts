export interface CiMetadata {
    prNumber?: number;
    prTitle?: string;
    /** PR base branch name (bare, e.g. "main"). PR events only. */
    baseRef?: string;
    /**
     * Source branch name (bare, e.g. "release/1.2.0").
     *
     * For `pull_request` / `pull_request_target`: PR head branch from the event
     * payload. For `push` / `workflow_dispatch`: derived from `GITHUB_REF` by
     * stripping the `refs/heads/` prefix. Omitted for tag pushes.
     */
    headRef?: string;
}
/**
 * Extract pull request and branch metadata from the GitHub event payload.
 *
 * - `pull_request` / `pull_request_target`: `prNumber`, `prTitle`, `baseRef`, `headRef`
 * - `push` (branch), `workflow_dispatch`, `schedule`, `merge_group`: `headRef`
 *   derived from `GITHUB_REF` (stripped of `refs/heads/`)
 * - tag pushes / other events: no branch metadata
 *
 * Never throws — metadata is best-effort and optional.
 */
export declare function getCiMetadata(): CiMetadata;
