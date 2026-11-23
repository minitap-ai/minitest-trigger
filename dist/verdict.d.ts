import type { WaitOutcome } from './wait-for-result';
export interface ReportVerdictOptions {
    failOnFailure: boolean;
    waitTimeoutMinutes: number;
}
/**
 * Turn a wait outcome into the action's observable result: the `result` and
 * `batch-url` outputs, and whether the step fails.
 *
 * `nothing_affected` is a PASS — the impact analysis found no scenario to run,
 * so the gate must stay green.
 */
export declare function reportVerdict(outcome: WaitOutcome, options: ReportVerdictOptions): void;
