export interface CiMetadata {
    prNumber?: number;
    prTitle?: string;
}
/**
 * Extract pull request metadata from the GitHub event payload.
 *
 * - `pull_request` / `pull_request_target` events → `prNumber`, `prTitle`
 *
 * Returns an empty object for events that don't carry PR metadata (e.g. push,
 * workflow_dispatch). Never throws — metadata is best-effort and optional.
 */
export declare function getCiMetadata(): CiMetadata;
