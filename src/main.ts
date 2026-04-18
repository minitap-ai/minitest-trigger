import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import { uploadBuild, triggerRun } from './api'
import { getCommitTitle } from './commit-title'
import {
  validateAtLeastOneBuild,
  validateAndroidBuild,
  validateIosBuild,
} from './validate'

async function run(): Promise<void> {
  try {
    // ── Read inputs ──────────────────────────────────────────────────
    const appSlug = core.getInput('app-slug', { required: true })
    const flowTypesRaw = core.getInput('flow-types')
    const iosBuildPath = core.getInput('ios-build-path')
    const androidBuildPath = core.getInput('android-build-path')
    const tenantId = core.getInput('tenant-id')
    const apiUrl = core.getInput('api-url')

    const flowTypes = flowTypesRaw
      ? flowTypesRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined

    // ── Resolve commit title ────────────────────────────────────────
    const commitTitle = getCommitTitle()

    // ── Validate builds ──────────────────────────────────────────────
    validateAtLeastOneBuild(iosBuildPath, androidBuildPath)

    let iosUploadPath: string | undefined
    const resolvedIosBuildPath = iosBuildPath
      ? path.resolve(iosBuildPath)
      : undefined
    if (iosBuildPath) {
      core.info('Validating iOS build...')
      iosUploadPath = validateIosBuild(iosBuildPath)
    }

    let androidUploadPath: string | undefined
    if (androidBuildPath) {
      core.info('Validating Android build...')
      androidUploadPath = validateAndroidBuild(androidBuildPath)
    }

    // ── Obtain OIDC token ────────────────────────────────────────────
    core.info(`Requesting GitHub OIDC token with audience: ${apiUrl}`)
    const token = await core.getIDToken(apiUrl)
    core.info('OIDC token obtained successfully')

    // ── Decode OIDC claims & extract commit SHA ────────────────────
    const payload = token.split('.')[1]
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    core.info('OIDC token claims:')
    core.info(JSON.stringify(claims, null, 2))

    const commitSha = claims.sha as string | undefined
    if (!commitSha) {
      throw new Error(
        'OIDC token is missing the "sha" claim — cannot determine commit SHA',
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
      flowTypes,
      iosBuildId,
      androidBuildId,
      tenantId: tenantId || undefined,
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
