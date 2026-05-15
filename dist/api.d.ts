export type Platform = 'ios' | 'android';
interface TriggerRunRequest {
    appSlug: string;
    commitTitle: string;
    /**
     * Optional commit SHA override. Honoured by the server only for
     * pull_request / pull_request_target events, where the OIDC `sha` claim
     * refers to the merge-commit and not the PR head. When omitted, the
     * server falls back to the OIDC `sha` claim.
     */
    commitSha?: string;
    userStoryTypes?: string[];
    platforms?: Platform[];
    iosBuildId?: string;
    androidBuildId?: string;
    tenantId?: string;
    prNumber?: number;
    prTitle?: string;
    /** PR base branch (bare name, e.g. "main"). PR events only. */
    baseRef?: string;
    /**
     * Source branch (bare name, e.g. "release/1.2.0"). PR head for PR events,
     * derived from `GITHUB_REF` for branch pushes / workflow_dispatch.
     */
    headRef?: string;
    /**
     * When true, the server cancels previous in-flight CI batches on the same
     * `headRef` if it matches the app's `release_branch_patterns`. No-op on
     * tag events, on non-release branches, or when `headRef` is missing.
     */
    cancelPreviousRuns?: boolean;
}
interface TriggerRunResponse {
    batchId: string;
    status: string;
    appId: string;
    appSlug: string;
}
interface UploadBuildOptions {
    apiUrl: string;
    token: string;
    buildPath: string;
    appSlug: string;
    commitTitle: string;
    commitSha: string;
    tenantId?: string;
}
/**
 * Upload a build artifact to the Minitap API.
 *
 * Accepts iOS builds (.ipa) or Android emulator builds (.apk).
 */
export declare function uploadBuild(options: UploadBuildOptions): Promise<string>;
/**
 * Trigger a test run batch via the Minitap CI API.
 */
export declare function triggerRun(apiUrl: string, token: string, request: TriggerRunRequest): Promise<TriggerRunResponse>;
export {};
