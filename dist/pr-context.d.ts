export interface PrContext {
    prNumber: number;
    prTitle?: string;
    baseRef?: string;
    headRef?: string;
    headSha?: string;
}
/**
 * Resolve the pull request behind an `issue_comment` event.
 *
 * The payload carries the issue number but neither the head SHA nor the
 * branch names, so they have to be fetched. Without them the run would be
 * anchored on the OIDC claims, which describe the default branch: the check
 * run would never show up in the PR and `cancel-previous-runs` would not match.
 *
 * Never throws — the run is still worth triggering without PR metadata.
 */
export declare function resolveIssueCommentPrContext(githubToken: string): Promise<PrContext | undefined>;
