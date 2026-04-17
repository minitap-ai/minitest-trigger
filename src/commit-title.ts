import * as fs from 'fs'
import { execSync } from 'child_process'
import * as core from '@actions/core'

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
export function getCommitTitle(): string {
  // 1. Explicit input takes priority
  const input = core.getInput('commit-title')
  if (input) {
    core.info(`Using commit title from input: ${firstLine(input)}`)
    return firstLine(input)
  }

  // 2. Read from GITHUB_EVENT_PATH payload
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath) {
    try {
      const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'))

      // Push events have head_commit.message
      const pushMessage = event?.head_commit?.message
      if (typeof pushMessage === 'string' && pushMessage.trim()) {
        const title = firstLine(pushMessage)
        core.info(`Using commit title from push event: ${title}`)
        return title
      }

      // PR events have pull_request.title
      const prTitle = event?.pull_request?.title
      if (typeof prTitle === 'string') {
        const title = firstLine(prTitle)
        if (title) {
          core.info(`Using commit title from pull request: ${title}`)
          return title
        }
      }
    } catch {
      core.warning('Failed to read GitHub event payload for commit title')
    }
  }

  // 3. Fall back to git log using GITHUB_SHA (works for workflow_dispatch, etc.)
  const sha = process.env.GITHUB_SHA
  if (sha) {
    try {
      const title = execSync(`git log -1 --format='%s' ${sha}`, {
        encoding: 'utf-8',
        timeout: 10_000,
      }).trim()

      if (title) {
        core.info(`Using commit title from git log: ${title}`)
        return title
      }
    } catch {
      core.warning('Failed to read commit title from git log')
    }
  }

  throw new Error(
    'Could not determine commit title.\n' +
      '  Provide it explicitly via the commit-title input, or ensure the\n' +
      '  action runs on a push or pull_request event.',
  )
}

/** Return the first non-empty line of the string, trimmed. */
function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
}
