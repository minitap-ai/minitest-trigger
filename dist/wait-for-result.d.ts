import { type RunResult } from './api';
export interface VerdictReached {
    timedOut: false;
    result: RunResult;
    batchId: string | null;
    url: string | null;
    failedStories: string[];
}
export interface VerdictTimedOut {
    timedOut: true;
    url: string | null;
}
export type WaitOutcome = VerdictReached | VerdictTimedOut;
export interface WaitForVerdictOptions {
    apiUrl: string;
    token: string;
    appSlug: string;
    commitSha: string;
    tenantId?: string;
    timeoutMs: number;
    /**
     * Mints a NEW OIDC token. Called when the current one is rejected.
     *
     * Required because `token` is obtained before the run is triggered and is
     * shorter-lived than the wait: without a way to get another, `timeoutMs` can
     * never exceed the credential's ~5 minutes in practice.
     */
    refreshToken?: () => Promise<string>;
}
/**
 * Poll the run status until it reaches a verdict or the timeout elapses.
 *
 * Transient poll failures are swallowed and retried; a client error is fatal,
 * since retrying one can never succeed.
 */
export declare function waitForVerdict(options: WaitForVerdictOptions): Promise<WaitOutcome>;
