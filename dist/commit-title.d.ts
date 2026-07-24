/**
 * Resolve the commit title (first line of the commit message) using multiple
 * fallback strategies:
 *
 *   1. Explicit `commit-title` action input (highest priority)
 *   2. GitHub event payload (`head_commit.message` for push events,
 *      `pull_request.title` for PR events)
 *   3. `git log` using GITHUB_SHA (works for any event type, e.g.
 *      workflow_dispatch, schedule)
 *
 * Returns the first line only (strips everything after the first newline).
 */
export declare function getCommitTitle(): string;
