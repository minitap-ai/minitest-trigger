import * as core from '@actions/core'
import { uploadBuild, triggerRun } from './api'

/**
 * The OIDC audience must match the testing-service's expected audience.
 * GitHub Actions will issue a JWT with this audience claim.
 */
const OIDC_AUDIENCE = 'https://testing-service.minitap.ai'

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

    // ── Obtain OIDC token ────────────────────────────────────────────
    core.info('Requesting GitHub OIDC token...')
    const token = await core.getIDToken(OIDC_AUDIENCE)
    core.info('OIDC token obtained successfully')

    // ── Upload builds (if provided) ──────────────────────────────────
    let iosBuildId: string | undefined
    let androidBuildId: string | undefined

    if (iosBuildPath) {
      core.info(`Uploading iOS build from: ${iosBuildPath}`)
      iosBuildId = await uploadBuild({
        apiUrl,
        token,
        buildPath: iosBuildPath,
        appSlug,
        tenantId: tenantId || undefined,
      })
    }

    if (androidBuildPath) {
      core.info(`Uploading Android build from: ${androidBuildPath}`)
      androidBuildId = await uploadBuild({
        apiUrl,
        token,
        buildPath: androidBuildPath,
        appSlug,
        tenantId: tenantId || undefined,
      })
    }

    // ── Trigger test run ─────────────────────────────────────────────
    const result = await triggerRun(apiUrl, token, {
      appSlug,
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
