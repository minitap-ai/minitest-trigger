import type { WebTargetSpec } from './api';
/** Parse comma-separated `<browser>:<viewport>` web-target tokens into `WebTargetSpec[]`. */
export declare function parseWebTargets(raw: string): WebTargetSpec[];
