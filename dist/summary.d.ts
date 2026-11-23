import type { CiTargetStatus, Platform } from './api';
import { type LabelledTarget } from './targets';
export interface TargetRow {
    label: string;
    platform: Platform;
    status: string;
    criticals: number;
    warnings: number;
}
export declare function requestedRows(targets: LabelledTarget[]): TargetRow[];
export declare function resultRows(targets: CiTargetStatus[]): TargetRow[];
/** "iOS: 2 critical · 1 warning", one line per platform that has targets. */
export declare function platformTotals(rows: TargetRow[]): string[];
/** Writes the `targets` output and the job summary table, one row per target. */
export declare function reportTargets(rows: TargetRow[], url: string | null): Promise<void>;
