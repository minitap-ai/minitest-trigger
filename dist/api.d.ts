export type Platform = 'ios' | 'android' | 'web';
/**
 * Which scenarios a run covers: `affected` (impacted since the last release, on
 * a matching release tag), `pr-affected` (impacted by this pull request) or
 * `full` (whole suite).
 */
export declare const RUN_SCOPES: readonly ["affected", "pr-affected", "full"];
export type RunScope = (typeof RUN_SCOPES)[number];
/**
 * A single web execution target.
 *
 * Mobile-web targets run on a real device and carry no viewport
 * (iOS uses Safari, Android uses Chrome). Browser-web targets run in a
 * browser and carry a `tablet` or `pc` viewport.
 */
export interface WebTargetSpec {
    platform: Platform;
    browser: 'chrome' | 'firefox' | 'safari';
    viewport?: 'tablet' | 'pc';
}
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
    /** Specific user story IDs (UUIDs) to run. Mutually exclusive with `userStoryTypes`. */
    userStoryIds?: string[];
    /** Ignored when `userStoryTypes`/`userStoryIds` is set; omit to let the server self-gate. */
    scope?: RunScope;
    platforms?: Platform[];
    iosBuildId?: string;
    androidBuildId?: string;
    /**
     * Explicit web targets. When omitted while the web lane is active, the
     * server expands the app's configured default web targets.
     */
    webTargets?: WebTargetSpec[];
    /** Per-run web URL override (e.g. a PR preview deployment). */
    webUrl?: string;
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
    /** Null when the server accepted the request without creating a batch. */
    batchId: string | null;
    status: string;
    appId: string;
    appSlug: string;
    /** Non-fatal notices about how the server interpreted the request. */
    warnings?: string[] | null;
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
/**
 * Terminal verdict of a run. `nothing_affected` means the impact analysis found
 * no scenario to run: it is a pass, not a failure and not a missing result.
 */
export type RunResult = 'passed' | 'failed' | 'error' | 'nothing_affected';
interface CiStatusResponse {
    /** `pending` means no batch exists yet — the analysis is still running. */
    state: 'pending' | 'running' | 'completed';
    result: RunResult | null;
    batchId: string | null;
    appId: string;
    appSlug: string;
    url: string | null;
    failedStories: string[];
}
interface CiStatusRequest {
    appSlug: string;
    commitSha: string;
    tenantId?: string;
}
/** Carries the status code so pollers can tell a fatal auth failure from a transient one. */
export declare class CiStatusError extends Error {
    readonly statusCode: number;
    constructor(message: string, statusCode: number);
}
/**
 * Fetch the current verdict of the run for a commit.
 *
 * Stays silent, unlike `triggerRun` — it is called on a polling loop.
 */
export declare function getCiStatus(apiUrl: string, token: string, request: CiStatusRequest): Promise<CiStatusResponse>;
export {};
