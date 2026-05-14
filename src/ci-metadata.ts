import * as fs from 'fs'
import * as core from '@actions/core'

export interface CiMetadata {
  prNumber?: number
  prTitle?: string
  /** PR base branch name (bare, e.g. "main"). PR events only. */
  baseRef?: string
  /**
   * Source branch name (bare, e.g. "release/1.2.0").
   *
   * For `pull_request` / `pull_request_target`: PR head branch from the event
   * payload. For `push` / `workflow_dispatch`: derived from `GITHUB_REF` by
   * stripping the `refs/heads/` prefix. Omitted for tag pushes.
   */
  headRef?: string
}

const REFS_HEADS_PREFIX = 'refs/heads/'

/** Branch-only events whose `GITHUB_REF` we forward as `headRef`. */
const BRANCH_REF_EVENTS = new Set([
  'push',
  'workflow_dispatch',
  'schedule',
  'merge_group',
])

const PR_EVENTS = new Set(['pull_request', 'pull_request_target'])

/**
 * Extract pull request and branch metadata from the GitHub event payload.
 *
 * - `pull_request` / `pull_request_target`: `prNumber`, `prTitle`, `baseRef`, `headRef`
 * - `push` (branch), `workflow_dispatch`, `schedule`, `merge_group`: `headRef`
 *   derived from `GITHUB_REF` (stripped of `refs/heads/`)
 * - tag pushes / other events: no branch metadata
 *
 * Never throws — metadata is best-effort and optional.
 */
export function getCiMetadata(): CiMetadata {
  const eventName = process.env.GITHUB_EVENT_NAME
  const metadata: CiMetadata = {}

  const eventPath = process.env.GITHUB_EVENT_PATH
  let event: Record<string, unknown> | undefined
  if (eventPath) {
    try {
      event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'))
    } catch {
      core.warning('Failed to read GitHub event payload for CI metadata')
    }
  }

  if (eventName && PR_EVENTS.has(eventName)) {
    const pr = event?.pull_request as
      | {
          number?: number
          title?: string
          base?: { ref?: string }
          head?: { ref?: string }
        }
      | undefined
    if (pr) {
      if (typeof pr.number === 'number') {
        metadata.prNumber = pr.number
      }
      if (typeof pr.title === 'string' && pr.title.trim()) {
        metadata.prTitle = pr.title.trim()
      }
      if (typeof pr.base?.ref === 'string' && pr.base.ref.trim()) {
        metadata.baseRef = pr.base.ref.trim()
      }
      if (typeof pr.head?.ref === 'string' && pr.head.ref.trim()) {
        metadata.headRef = pr.head.ref.trim()
      }
    }
    if (!metadata.baseRef || !metadata.headRef) {
      core.warning(
        'PR event payload missing base.ref or head.ref — branch-aware features (e.g. cancel-previous-runs) will be skipped server-side.',
      )
    }
  } else if (eventName && BRANCH_REF_EVENTS.has(eventName)) {
    const ref = process.env.GITHUB_REF
    if (ref && ref.startsWith(REFS_HEADS_PREFIX)) {
      metadata.headRef = ref.slice(REFS_HEADS_PREFIX.length)
    }
  }

  if (metadata.prNumber !== undefined || metadata.prTitle) {
    core.info(
      `Detected pull request metadata: #${metadata.prNumber ?? '?'} ${
        metadata.prTitle ?? ''
      }`.trim(),
    )
  }
  if (metadata.baseRef || metadata.headRef) {
    core.info(
      `Detected branch metadata: head=${metadata.headRef ?? '?'} base=${
        metadata.baseRef ?? '-'
      }`,
    )
  }

  return metadata
}
