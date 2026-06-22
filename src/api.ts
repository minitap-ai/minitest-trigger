import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'
import { Readable } from 'stream'
import { HttpClient } from '@actions/http-client'

const client = new HttpClient('minitap-trigger-action')

/** Standard error envelope returned by the Minitap API. */
interface ApiError {
  error: string
  message: string
  details?: {
    errors?: Array<{ field: string; message: string; type: string }>
  }
}

/** Single issue produced by the build-compatibility validator (warnings + hard errors). */
interface BuildValidationIssue {
  code: string
  message: string
  detail?: Record<string, unknown>
}

/**
 * Error envelope returned by the build-compatibility validator (422).
 *
 * Emitted by the bespoke handler in testing-service `main.py` when the
 * upload route raises `BuildValidationError`. Shape diverges from the
 * standard `ApiError` envelope so it gets its own type.
 */
interface BuildInvalidError {
  error_code: 'build_invalid'
  issues: BuildValidationIssue[]
}

/**
 * Parse an API error response into a user-friendly message.
 *
 * Two envelopes are handled:
 *   - Standard:     { error, message, details? }
 *   - build_invalid:{ error_code: "build_invalid", issues: [...] } — emitted
 *                   by the build-compatibility validator on upload.
 *
 * For build-validation errors each issue is also emitted as a GitHub
 * Annotation so it surfaces on the workflow summary, in addition to being
 * rendered in the thrown Error message.
 */
function formatApiError(
  context: string,
  statusCode: number,
  body: string,
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // Response wasn't JSON — fall back to raw body
    return `${context} (HTTP ${statusCode}): ${body}`
  }

  if (isBuildInvalidError(parsed)) {
    for (const issue of parsed.issues) {
      core.error(issue.message, { title: issue.code })
    }
    const issueLines = parsed.issues
      .map((i) => `  • ${i.code}: ${i.message}`)
      .join('\n')
    return `${context}: build cannot run on virtual devices\n${issueLines}`
  }

  if (!isApiError(parsed)) {
    // Unknown shape — preserve the raw JSON so the real failure isn't lost
    return `${context} (HTTP ${statusCode}): ${JSON.stringify(parsed)}`
  }

  let msg = `${context}: ${parsed.message} (${parsed.error})`

  // Append field-level validation errors if present
  if (parsed.details?.errors?.length) {
    const fieldErrors = parsed.details.errors
      .map((e) => `  • ${e.field}: ${e.message}`)
      .join('\n')
    msg += `\n${fieldErrors}`
  }

  return msg
}

function isBuildValidationIssue(value: unknown): value is BuildValidationIssue {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { code?: unknown; message?: unknown }
  return (
    typeof candidate.code === 'string' && typeof candidate.message === 'string'
  )
}

function isBuildInvalidError(value: unknown): value is BuildInvalidError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { error_code?: unknown; issues?: unknown }
  return (
    candidate.error_code === 'build_invalid' &&
    Array.isArray(candidate.issues) &&
    candidate.issues.every(isBuildValidationIssue)
  )
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { error?: unknown; message?: unknown }
  return (
    typeof candidate.error === 'string' && typeof candidate.message === 'string'
  )
}

interface UploadResponse {
  buildId: string
  platform: 'ios' | 'android'
  appId: string
  validationWarnings?: BuildValidationIssue[] | null
}

export type Platform = 'ios' | 'android' | 'web'

/**
 * A single web execution target.
 *
 * Mobile-web targets run on a real device and carry no viewport
 * (iOS uses Safari, Android uses Chrome). Desktop-web targets run in a
 * browser and carry a `pc` viewport.
 */
export interface WebTargetSpec {
  platform: Platform
  browser: 'chrome' | 'firefox' | 'safari'
  viewport?: 'pc'
}

interface TriggerRunRequest {
  appSlug: string
  commitTitle: string
  /**
   * Optional commit SHA override. Honoured by the server only for
   * pull_request / pull_request_target events, where the OIDC `sha` claim
   * refers to the merge-commit and not the PR head. When omitted, the
   * server falls back to the OIDC `sha` claim.
   */
  commitSha?: string
  userStoryTypes?: string[]
  /** Specific user story IDs (UUIDs) to run. Mutually exclusive with `userStoryTypes`. */
  userStoryIds?: string[]
  platforms?: Platform[]
  iosBuildId?: string
  androidBuildId?: string
  /**
   * Explicit web targets. When omitted while the web lane is active, the
   * server expands the app's configured default web targets.
   */
  webTargets?: WebTargetSpec[]
  /** Per-run web URL override (e.g. a PR preview deployment). */
  webUrl?: string
  tenantId?: string
  prNumber?: number
  prTitle?: string
  /** PR base branch (bare name, e.g. "main"). PR events only. */
  baseRef?: string
  /**
   * Source branch (bare name, e.g. "release/1.2.0"). PR head for PR events,
   * derived from `GITHUB_REF` for branch pushes / workflow_dispatch.
   */
  headRef?: string
  /**
   * When true, the server cancels previous in-flight CI batches on the same
   * `headRef` if it matches the app's `release_branch_patterns`. No-op on
   * tag events, on non-release branches, or when `headRef` is missing.
   */
  cancelPreviousRuns?: boolean
}

interface TriggerRunResponse {
  batchId: string
  status: string
  appId: string
  appSlug: string
}

interface UploadBuildOptions {
  apiUrl: string
  token: string
  buildPath: string
  appSlug: string
  commitTitle: string
  commitSha: string
  tenantId?: string
}

/**
 * Upload a build artifact to the Minitap API.
 *
 * Accepts iOS builds (.ipa) or Android emulator builds (.apk).
 */
export async function uploadBuild(
  options: UploadBuildOptions,
): Promise<string> {
  const {
    apiUrl,
    token,
    buildPath,
    appSlug,
    commitTitle,
    commitSha,
    tenantId,
  } = options
  const absolutePath = path.resolve(buildPath)

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Build file not found: ${absolutePath}`)
  }

  const ext = path.extname(absolutePath)
  const fileName = `commit-${commitSha}${ext}`
  const fileBuffer = fs.readFileSync(absolutePath)
  const boundary = `----FormBoundary${Date.now()}`

  // Build multipart form body with required fields
  const parts: Buffer[] = []

  // app_slug field (required)
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="app_slug"\r\n\r\n${appSlug}\r\n`,
      'utf-8',
    ),
  )

  // commit_title field (required)
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="commit_title"\r\n\r\n${commitTitle}\r\n`,
      'utf-8',
    ),
  )

  // commit_sha field (optional override; honoured by the server only on PR events)
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="commit_sha"\r\n\r\n${commitSha}\r\n`,
      'utf-8',
    ),
  )

  // tenant_id field (optional)
  if (tenantId) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="tenant_id"\r\n\r\n${tenantId}\r\n`,
        'utf-8',
      ),
    )
  }

  // file field
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      'utf-8',
    ),
  )
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'))

  const body = Buffer.concat(parts)
  const url = `${apiUrl}/api/v1/ci/builds/upload`

  core.info(
    `Uploading ${fileName} (${formatBytes(fileBuffer.length)}) to ${url}`,
  )

  const stream = Readable.from(body)
  const response = await client.request('POST', url, stream, {
    Authorization: `Bearer ${token}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length.toString(),
  })

  const statusCode = response.message.statusCode ?? 0

  const responseBody = await response.readBody()

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      formatApiError('Build upload failed', statusCode, responseBody),
    )
  }

  const data = JSON.parse(responseBody) as UploadResponse

  core.info(`Upload successful — build ID: ${data.buildId} (${data.platform})`)

  // Surface non-fatal build-compatibility warnings as GitHub Annotations so
  // they appear on the workflow summary alongside the run results.
  if (data.validationWarnings?.length) {
    core.info(
      `Build uploaded with ${data.validationWarnings.length} compatibility warning(s):`,
    )
    for (const warning of data.validationWarnings) {
      core.warning(warning.message, { title: warning.code })
      core.info(`  • ${warning.code}: ${warning.message}`)
    }
  }

  return data.buildId
}

/**
 * Trigger a test run batch via the Minitap CI API.
 */
export async function triggerRun(
  apiUrl: string,
  token: string,
  request: TriggerRunRequest,
): Promise<TriggerRunResponse> {
  const url = `${apiUrl}/api/v1/ci/run`
  const body = JSON.stringify(request)

  core.info(`Triggering test run for app "${request.appSlug}"`)

  const response = await client.request('POST', url, body, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })

  const statusCode = response.message.statusCode ?? 0
  const responseBody = await response.readBody()

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      formatApiError('Trigger run failed', statusCode, responseBody),
    )
  }

  const data = JSON.parse(responseBody) as TriggerRunResponse

  return data
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
