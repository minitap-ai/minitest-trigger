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

/**
 * Parse an API error response into a user-friendly message.
 *
 * The Minitap API returns errors in a standard envelope:
 *   { error: "not_found", message: "App with slug 'x' not found ...", details?: {...} }
 *
 * For validation errors (422), individual field errors are included in `details.errors`.
 */
function formatApiError(
  context: string,
  statusCode: number,
  body: string,
): string {
  try {
    const data = JSON.parse(body) as ApiError
    let msg = `${context}: ${data.message} (${data.error})`

    // Append field-level validation errors if present
    if (data.details?.errors?.length) {
      const fieldErrors = data.details.errors
        .map((e) => `  • ${e.field}: ${e.message}`)
        .join('\n')
      msg += `\n${fieldErrors}`
    }

    return msg
  } catch {
    // Response wasn't JSON — fall back to raw body
    return `${context} (HTTP ${statusCode}): ${body}`
  }
}

interface UploadResponse {
  buildId: string
  platform: 'ios' | 'android'
  appId: string
}

export type Platform = 'ios' | 'android'

interface TriggerRunRequest {
  appSlug: string
  commitTitle: string
  userStoryTypes?: string[]
  platforms?: Platform[]
  iosBuildId?: string
  androidBuildId?: string
  tenantId?: string
  prNumber?: number
  prTitle?: string
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
