import type { Platform, RunTarget } from './api';
/** Parse the `targets` input: one target per line, each a comma-separated list of key=value pairs. */
export declare function parseTargets(raw: string): RunTarget[];
export declare function parseTargetLine(line: string): RunTarget;
export interface LabelledTarget {
    platform: Platform;
    backend?: string | null;
    deviceType?: string | null;
    deviceModels?: string[] | null;
    osVersion?: string | null;
    browser?: string | null;
    browserVersionRequested?: string | null;
    browserVersion?: string | null;
    viewport?: string | null;
}
/** The webapp's name for a target: "iPhone · iOS 27", "Chrome 157 · Desktop". */
export declare function targetLabel(target: LabelledTarget): string;
