import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import { uploadBuild, triggerRun, type Platform } from './api'
import { getCiMetadata } from './ci-metadata'
import { getCommitTitle } from './commit-title'
import { resolvePrHeadSha } from './commit-sha'
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
    const runIos = core.getBooleanInput('run-ios')
    const runAndroid = core.getBooleanInput('run-android')
    const iosBuildPath = core.getInput('ios-build-path')
    const androidBuildPath = core.getInput('android-build-path')
    const tenantId = core.getInput('tenant-id')
    const apiUrl = core.getInput('api-url')
    const cancelPreviousRuns = core.getBooleanInput('cancel-previous-runs')

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

    // Build the platforms array forwarded to the server. Only sent when the
    // user opts out of one platform — when both are enabled (the default),
    // we omit the field so the server's "both" default applies.
    const platforms: Platform[] | undefined =
      runIos && runAndroid
        ? undefined
        : ([runIos && 'ios', runAndroid && 'android'].filter(
            Boolean,
          ) as Platform[])

    // ── Resolve commit title ────────────────────────────────────────
    const commitTitle = getCommitTitle()

    // ── Resolve CI metadata (PR / release info) ─────────────────────
    const ciMetadata = getCiMetadata()

    // ── Validate run-flag / build-path combination ───────────────────
    validateRunFlags({ runIos, runAndroid, iosBuildPath, androidBuildPath })

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

    // ── PR-event SHA override ─────────────────────────────────────────
    // For pull_request / pull_request_target, claims.sha is the ephemeral
    // test-merge commit and not addressable from the PR Checks tab. Prefer
    // pull_request.head.sha read from the event payload when available.
    const eventName = process.env.GITHUB_EVENT_NAME
    const prHeadSha = resolvePrHeadSha(eventName)
    const commitSha = prHeadSha ?? oidcSha
    if (prHeadSha && prHeadSha !== oidcSha) {
      core.info(
        `Using PR head SHA ${prHeadSha} from event payload instead of OIDC merge SHA ${oidcSha}`,
      )
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
      platforms,
      iosBuildId,
      androidBuildId,
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
