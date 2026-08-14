import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import { uploadBuild, triggerRun, type Platform, type RunScope } from './api'
import { getCiMetadata } from './ci-metadata'
import { getCommitTitle } from './commit-title'
import { resolvePrHeadSha } from './commit-sha'
import { resolveIssueCommentPrContext } from './pr-context'
import { parseWebTargets } from './web-targets'
import {
  validateRunFlags,
  validateAndroidBuild,
  validateIosBuild,
} from './validate'

const DEFAULT_API_URL = 'https://testing-service.app.minitap.ai'

async function run(): Promise<void> {
  try {
    // ── Read inputs ──────────────────────────────────────────────────
    const appSlug = core.getInput('app-slug', { required: true })
    const userStoryTypesRaw = core.getInput('user-story-types')
    const userStoryIdsRaw = core.getInput('user-stories')
    const scopeRaw = core.getInput('scope')
    const runIos = core.getBooleanInput('run-ios')
    const runAndroid = core.getBooleanInput('run-android')
    const runWeb = core.getBooleanInput('run-web')
    const iosBuildPath = core.getInput('ios-build-path')
    const androidBuildPath = core.getInput('android-build-path')
    const webTargetsRaw = core.getInput('web-targets')
    const webUrl = core.getInput('web-url')
    const tenantId = core.getInput('tenant-id')
    const apiUrl = core.getInput('api-url')
    const cancelPreviousRuns = core.getBooleanInput('cancel-previous-runs')
    const githubToken = core.getInput('github-token')

    const userStoryTypes = userStoryTypesRaw
      ? userStoryTypesRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined

    const userStoryIds = userStoryIdsRaw
      ? userStoryIdsRaw
          .split(/[\n,]/)
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined

    if (userStoryTypes?.length && userStoryIds?.length) {
      throw new Error(
        '`user-story-types` and `user-stories` are mutually exclusive — provide only one.',
      )
    }

    const scopeNormalized = scopeRaw ? scopeRaw.trim().toLowerCase() : undefined
    if (
      scopeNormalized &&
      scopeNormalized !== 'affected' &&
      scopeNormalized !== 'full'
    ) {
      throw new Error(
        `\`scope\` must be "affected" or "full" (got "${scopeRaw}").`,
      )
    }
    const scope = scopeNormalized as RunScope | undefined

    const parsedWebTargets = webTargetsRaw
      ? parseWebTargets(webTargetsRaw)
      : undefined
    const webTargets = parsedWebTargets?.length ? parsedWebTargets : undefined
    const wantWeb = runWeb || webTargets !== undefined

    // Build the platforms array forwarded to the server. Omitted only when
    // both native platforms are enabled and the web lane is off (the default),
    // so the server's "both natives, web when configured" default applies.
    const platforms: Platform[] | undefined =
      runIos && runAndroid && !wantWeb
        ? undefined
        : ([runIos && 'ios', runAndroid && 'android', wantWeb && 'web'].filter(
            Boolean,
          ) as Platform[])

    // ── Resolve CI metadata (PR / release info) ─────────────────────
    const eventName = process.env.GITHUB_EVENT_NAME
    const ciMetadata = getCiMetadata()

    // An issue_comment payload names the PR but carries neither its head SHA
    // nor its branches, so they have to be fetched.
    const issueCommentPr =
      eventName === 'issue_comment'
        ? await resolveIssueCommentPrContext(githubToken)
        : undefined
    if (issueCommentPr) {
      ciMetadata.prNumber = issueCommentPr.prNumber
      ciMetadata.prTitle = issueCommentPr.prTitle
      ciMetadata.baseRef = issueCommentPr.baseRef
      ciMetadata.headRef = issueCommentPr.headRef
      core.info(
        `Attaching run to pull request #${issueCommentPr.prNumber} (head=${issueCommentPr.headRef ?? '?'} base=${issueCommentPr.baseRef ?? '?'})`,
      )
    }

    // ── Resolve commit title ────────────────────────────────────────
    const commitTitle = getCommitTitle()

    // ── Validate run-flag / build-path combination ───────────────────
    validateRunFlags({
      runIos,
      runAndroid,
      wantWeb,
      iosBuildPath,
      androidBuildPath,
    })

    let iosUploadPath: string | undefined
    const resolvedIosBuildPath = iosBuildPath
      ? path.resolve(iosBuildPath)
      : undefined
    if (iosBuildPath) {
      core.info('Validating iOS build...')
      iosUploadPath = validateIosBuild(iosBuildPath)
    } else if (runIos) {
      core.info(
        'No `ios-build-path` provided — Minitest will build the iOS app for this commit',
      )
    }

    let androidUploadPath: string | undefined
    if (androidBuildPath) {
      core.info('Validating Android build...')
      androidUploadPath = validateAndroidBuild(androidBuildPath)
    } else if (runAndroid) {
      core.info(
        'No `android-build-path` provided — Minitest will build the Android app for this commit',
      )
    }

    // ── Obtain OIDC token ────────────────────────────────────────────
    core.info(`Requesting GitHub OIDC token with audience: ${apiUrl}`)
    const token = await core.getIDToken(apiUrl)
    core.info('OIDC token obtained successfully')

    // ── Decode OIDC claims & extract commit SHA ────────────────────
    const payload = token.split('.')[1]
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    // Only dump the decoded claims when the user is pointing at a non-default
    // API endpoint (debugging custom deployments). Avoids leaking metadata
    // (repo, ref, run id, etc.) into logs of regular customer workflows.
    if (apiUrl !== DEFAULT_API_URL) {
      core.info('OIDC token claims:')
      core.info(JSON.stringify(claims, null, 2))
    }

    const oidcSha = claims.sha as string | undefined
    if (!oidcSha) {
      throw new Error(
        'OIDC token is missing the "sha" claim — cannot determine commit SHA',
      )
    }

    // ── PR-context SHA override ───────────────────────────────────────
    // claims.sha is the ephemeral test-merge commit on pull_request events and
    // the default-branch head on issue_comment — neither is addressable from
    // the PR Checks tab. Prefer the PR head SHA whenever we could resolve one.
    const prHeadSha = issueCommentPr?.headSha ?? resolvePrHeadSha(eventName)
    const commitSha = prHeadSha ?? oidcSha
    if (prHeadSha && prHeadSha !== oidcSha) {
      core.info(`Using PR head SHA ${prHeadSha} instead of OIDC sha ${oidcSha}`)
    }

    // ── Upload builds ────────────────────────────────────────────────
    let iosBuildId: string | undefined
    let androidBuildId: string | undefined

    if (iosUploadPath) {
      core.info(`Uploading iOS build from: ${iosUploadPath}`)
      try {
        iosBuildId = await uploadBuild({
          apiUrl,
          token,
          buildPath: iosUploadPath,
          appSlug,
          commitTitle,
          commitSha,
          tenantId: tenantId || undefined,
        })
      } finally {
        // Clean up temp .ipa if we packaged a .app bundle
        if (iosUploadPath !== resolvedIosBuildPath) {
          fs.rmSync(iosUploadPath, { force: true })
          core.info('Cleaned up temporary .ipa file')
        }
      }
    }

    if (androidUploadPath) {
      core.info(`Uploading Android build from: ${androidUploadPath}`)
      androidBuildId = await uploadBuild({
        apiUrl,
        token,
        buildPath: androidUploadPath,
        appSlug,
        commitTitle,
        commitSha,
        tenantId: tenantId || undefined,
      })
    }

    // ── Trigger test run ─────────────────────────────────────────────
    const result = await triggerRun(apiUrl, token, {
      appSlug,
      commitTitle,
      commitSha,
      userStoryTypes,
      userStoryIds,
      scope,
      platforms,
      iosBuildId,
      androidBuildId,
      webTargets: wantWeb ? webTargets : undefined,
      webUrl: wantWeb ? webUrl.trim() || undefined : undefined,
      tenantId: tenantId || undefined,
      prNumber: ciMetadata.prNumber,
      prTitle: ciMetadata.prTitle,
      baseRef: ciMetadata.baseRef,
      headRef: ciMetadata.headRef,
      cancelPreviousRuns,
    })

    // ── Output results ───────────────────────────────────────────────
    core.info('────────────────────────────────────────────')
    core.info(`Test run triggered successfully!`)
    core.info(`Batch ID: ${result.batchId}`)
    core.info(`Status:   ${result.status}`)
    core.info('────────────────────────────────────────────')
    core.info('Results will be reported back via GitHub Check Runs.')

    core.setOutput('batch-id', result.batchId)
    core.setOutput('status', result.status)
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()
