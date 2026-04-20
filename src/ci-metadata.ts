import * as fs from 'fs'
import * as core from '@actions/core'

export interface CiMetadata {
  prNumber?: number
  prTitle?: string
}

/**
 * Extract pull request metadata from the GitHub event payload.
 *
 * - `pull_request` / `pull_request_target` events → `prNumber`, `prTitle`
 *
 * Returns an empty object for events that don't carry PR metadata (e.g. push,
 * workflow_dispatch). Never throws — metadata is best-effort and optional.
 */
export function getCiMetadata(): CiMetadata {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return {}

  let event: Record<string, unknown>
  try {
    event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'))
  } catch {
    core.warning('Failed to read GitHub event payload for CI metadata')
    return {}
  }

  const metadata: CiMetadata = {}

  const pr = event?.pull_request as
    | { number?: number; title?: string }
    | undefined
  if (pr) {
    if (typeof pr.number === 'number') {
      metadata.prNumber = pr.number
    }
    if (typeof pr.title === 'string' && pr.title.trim()) {
      metadata.prTitle = pr.title.trim()
    }
  }

  if (metadata.prNumber !== undefined || metadata.prTitle) {
    core.info(
      `Detected pull request metadata: #${metadata.prNumber ?? '?'} ${
        metadata.prTitle ?? ''
      }`.trim(),
    )
  }

  return metadata
}
