import * as fs from 'fs'
import * as core from '@actions/core'
import { HttpClient } from '@actions/http-client'

export interface PrContext {
  prNumber: number
  prTitle?: string
  baseRef?: string
  headRef?: string
  headSha?: string
}

interface PullRequestResponse {
  title?: string
  base?: { ref?: string }
  head?: { ref?: string; sha?: string }
}

function readIssueNumber(): number | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    core.warning(
      'GITHUB_EVENT_PATH is unset on an issue_comment event — the run will not be attached to the pull request',
    )
    return undefined
  }
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'))
    if (!event?.issue?.pull_request) {
      return undefined
    }
    const number = event.issue.number
    return typeof number === 'number' ? number : undefined
  } catch (err) {
    core.warning(
      `Failed to read GitHub event payload: ${err instanceof Error ? err.message : String(err)}`,
    )
    return undefined
  }
}

/**
 * Resolve the pull request behind an `issue_comment` event.
 *
 * The payload carries the issue number but neither the head SHA nor the
 * branch names, so they have to be fetched. Without them the run would be
 * anchored on the OIDC claims, which describe the default branch: the check
 * run would never show up in the PR and `cancel-previous-runs` would not match.
 *
 * Never throws — the run is still worth triggering without PR metadata.
 */
export async function resolveIssueCommentPrContext(
  githubToken: string,
): Promise<PrContext | undefined> {
  const prNumber = readIssueNumber()
  if (prNumber === undefined) {
    return undefined
  }

  const repository = process.env.GITHUB_REPOSITORY
  if (!repository) {
    core.warning('GITHUB_REPOSITORY is unset — cannot resolve pull request')
    return undefined
  }
  if (!githubToken) {
    core.warning(
      '`github-token` is empty — cannot resolve the pull request behind this comment. Pass `github-token: ${{ github.token }}` with `permissions: pull-requests: read`.',
    )
    return { prNumber }
  }

  const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com'
  const url = `${apiBase}/repos/${repository}/pulls/${prNumber}`

  try {
    const client = new HttpClient('minitap-trigger-action')
    const response = await client.getJson<PullRequestResponse>(url, {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
    })

    if (response.statusCode !== 200 || !response.result) {
      core.warning(
        `GET ${url} returned ${response.statusCode} — the run will not carry pull request metadata`,
      )
      return { prNumber }
    }

    const pr = response.result
    const headSha = pr.head?.sha
    return {
      prNumber,
      prTitle: pr.title?.trim() || undefined,
      baseRef: pr.base?.ref?.trim() || undefined,
      headRef: pr.head?.ref?.trim() || undefined,
      headSha:
        typeof headSha === 'string' && /^[0-9a-f]{40}$/.test(headSha)
          ? headSha
          : undefined,
    }
  } catch (err) {
    core.warning(
      `Failed to resolve pull request #${prNumber}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return { prNumber }
  }
}
