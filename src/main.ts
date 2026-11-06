import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import {
  uploadBuild,
  triggerRun,
  RUN_SCOPES,
  TriggerRunError,
  type Platform,
  type RunScope,
  type RunTarget,
} from './api'
import { parseTargets } from './targets'
import { reportTargets, requestedRows, resultRows } from './summary'
import { getCiMetadata } from './ci-metadata'
import { getCommitTitle } from './commit-title'
import { resolvePrHeadSha } from './commit-sha'
import { resolveIssueCommentPrContext } from './pr-context'
import { parseWebTargets } from './web-targets'
import {
  parseDeviceType,
  validateRunFlags,
  validateTargetsInputs,
  validateAndroidBuild,
  validateIosBuild,
} from './validate'
import { waitForVerdict } from './wait-for-result'
import { reportVerdict } from './verdict'

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
    const iosDeviceType = parseDeviceType(
      core.getInput('ios-device-type'),
      'ios-device-type',
    )
    const androidDeviceType = parseDeviceType(
      core.getInput('android-device-type'),
      'android-device-type',
    )
    const iosBuildPath = core.getInput('ios-build-path')
    const androidBuildPath = core.getInput('android-build-path')
    const webTargetsRaw = core.getInput('web-targets')
    const targetsRaw = core.getInput('targets')
    const webUrl = core.getInput('web-url')
    const tenantId = core.getInput('tenant-id')
    const apiUrl = core.getInput('api-url')
    const cancelPreviousRuns = core.getBooleanInput('cancel-previous-runs')
    const githubToken = core.getInput('github-token')
    const waitForResult = core.getBooleanInput('wait-for-result')
    const waitTimeoutMinutesRaw = core.getInput('wait-timeout-minutes')
    const failOnFailure = core.getBooleanInput('fail-on-failure')

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

    if (failOnFailure && !waitForResult) {
      throw new Error(
        '`fail-on-failure` requires `wait-for-result: true` — without waiting for a verdict there is nothing to fail on.',
      )
    }

    let waitTimeoutMinutes = 0
    if (waitForResult) {
      waitTimeoutMinutes = Number(waitTimeoutMinutesRaw)
      if (!Number.isFinite(waitTimeoutMinutes) || waitTimeoutMinutes <= 0) {
        throw new Error(
          `\`wait-timeout-minutes\` must be a positive number (got "${waitTimeoutMinutesRaw}").`,
        )
      }
    }

    const scopeNormalized = scopeRaw ? scopeRaw.trim().toLowerCase() : undefined
    if (scopeNormalized && !RUN_SCOPES.includes(scopeNormalized as RunScope)) {
      throw new Error(
        `\`scope\` must be one of ${RUN_SCOPES.map((value) => `"${value}"`).join(', ')} (got "${scopeRaw}").`,
      )
    }
    const scope = scopeNormalized as RunScope | undefined

    const parsedTargets = targetsRaw ? parseTargets(targetsRaw) : []
    const targets = parsedTargets.length ? parsedTargets : undefined
    const parsedWebTargets = webTargetsRaw
      ? parseWebTargets(webTargetsRaw)
      : undefined
    const webTargets = parsedWebTargets?.length ? parsedWebTargets : undefined

    let wantWeb: boolean
    let platforms: Platform[] | undefined
    if (targets) {
      validateTargetsInputs({
        targets,
        runIos,
        runAndroid,
        runWeb,
        iosBuildPath,
        androidBuildPath,
        iosDeviceType,
        androidDeviceType,
        webTargets: webTargetsRaw,
        webUrl,
      })
      wantWeb = targets.some((target) => target.platform === 'web')
    } else {
      wantWeb = runWeb || webTargets !== undefined
      validateRunFlags({
        runIos,
        runAndroid,
        wantWeb,
        iosBuildPath,
        androidBuildPath,
        iosDeviceType,
        androidDeviceType,
      })
      // Omitted only when both native platforms are enabled and the web lane
      // is off (the default), so the server's "both natives, web when
      // configured" default applies.
      platforms =
        runIos && runAndroid && !wantWeb
          ? undefined
          : ([
              runIos && 'ios',
              runAndroid && 'android',
              wantWeb && 'web',
            ].filter(Boolean) as Platform[])
    }
    const nativeLanes = new Set(
      targets
        ? targets.map((target) => target.platform)
        : [runIos && 'ios', runAndroid && 'android'],
    )

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

    let iosUploadPath: string | undefined
    const resolvedIosBuildPath = iosBuildPath
      ? path.resolve(iosBuildPath)
      : undefined
    if (iosBuildPath) {
      core.info('Validating iOS build...')
      iosUploadPath = validateIosBuild(iosBuildPath)
    } else if (nativeLanes.has('ios')) {
      core.info(
        'No `ios-build-path` provided — Minitest will build the iOS app for this commit',
      )
    }

    let androidUploadPath: string | undefined
    if (androidBuildPath) {
      core.info('Validating Android build...')
      androidUploadPath = validateAndroidBuild(androidBuildPath)
    } else if (nativeLanes.has('android')) {
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
    const lanes = targets
      ? {
          targets: withBuilds(targets, {
            ios: iosBuildId,
            android: androidBuildId,
          }),
        }
      : {
          platforms,
          iosBuildId,
          androidBuildId,
          iosDeviceType,
          androidDeviceType,
          webTargets: wantWeb ? webTargets : undefined,
        }
    const result = await triggerRun(apiUrl, token, {
      appSlug,
      commitTitle,
      commitSha,
      userStoryTypes,
      userStoryIds,
      scope,
      ...lanes,
      webUrl: wantWeb ? webUrl.trim() || undefined : undefined,
      tenantId: tenantId || undefined,
      prNumber: ciMetadata.prNumber,
      prTitle: ciMetadata.prTitle,
      baseRef: ciMetadata.baseRef,
      headRef: ciMetadata.headRef,
      cancelPreviousRuns,
    }).catch((error: unknown) => {
      throw targets ? explainTargetRefusal(error) : error
    })

    core.info('────────────────────────────────────────────')
    if (result.batchId === null) {
      core.info(
        result.launchIntentId
          ? `Waiting for launch: ${result.launchIntentId}`
          : 'Request accepted without a batch.',
      )
    } else {
      core.info(`Test run triggered successfully!`)
      core.info(`Batch ID: ${result.batchId}`)
      core.info(`Status:   ${result.status}`)
      core.info('Results will be reported back via GitHub Check Runs.')
    }
    core.info('────────────────────────────────────────────')

    core.setOutput('batch-id', result.batchId ?? '')
    core.setOutput('status', result.status)
    const requested = requestedRows(targets ?? [])

    if (!waitForResult) {
      core.setOutput('result', '')
      core.setOutput('batch-url', '')
      await reportTargets(requested, null)
      return
    }

    const selector = result.batchId
      ? { batchId: result.batchId }
      : result.launchIntentId
        ? { launchIntentId: result.launchIntentId }
        : null
    if (!selector) {
      if (result.warnings?.includes('nothing_affected')) {
        reportVerdict(
          {
            timedOut: false,
            result: 'nothing_affected',
            batchId: null,
            url: null,
            failedStories: [],
          },
          { failOnFailure, waitTimeoutMinutes },
        )
        return
      }
      core.setOutput('result', '')
      core.setOutput('batch-url', '')
      throw new Error(
        'Run verdict unavailable: the server returned no immutable batchId or launchIntentId. Upgrade testing-service; analysis progress or the latest commit cannot identify this execution.',
      )
    }

    const outcome = await waitForVerdict({
      ...selector,
      apiUrl,
      token,
      appSlug,
      tenantId: tenantId || undefined,
      timeoutMs: waitTimeoutMinutes * 60_000,
      refreshToken: () => core.getIDToken(apiUrl),
    })

    if (!outcome.timedOut) core.setOutput('batch-id', outcome.batchId ?? '')
    const ran = outcome.timedOut ? [] : (outcome.targets ?? [])
    await reportTargets(ran.length ? resultRows(ran) : requested, outcome.url)
    reportVerdict(outcome, { failOnFailure, waitTimeoutMinutes })
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

function withBuilds(
  targets: RunTarget[],
  builds: Partial<Record<Platform, string>>,
): RunTarget[] {
  return targets.map((target) => {
    const buildId =
      target.platform === 'web' ? undefined : builds[target.platform]
    return buildId ? { ...target, buildId } : target
  })
}

const REFUSAL_HINTS: Array<[RegExp, string]> = [
  [
    /Several native targets|may appear at most once per batch/,
    'This workspace runs one device per platform. Keep one `ios` and one `android` line in `targets`, or ask Minitap to enable several devices per platform.',
  ],
  [
    /browser_version_requested/,
    'Browser versions are not enabled for this workspace yet. Remove `version=` from the web lines in `targets`, or ask Minitap to enable them.',
  ],
  [
    /tablet/i,
    'Tablets are not enabled for this workspace yet. Remove `device=tablet` from `targets`, or ask Minitap to enable them.',
  ],
  [
    /\btv\b|Android TV/i,
    'Android TV is not enabled for this workspace yet. Remove `device=tv` from `targets`, or ask Minitap to enable it.',
  ],
]

function explainTargetRefusal(error: unknown): unknown {
  if (
    !(error instanceof TriggerRunError) ||
    (error.statusCode !== 422 && error.statusCode !== 403)
  ) {
    return error
  }
  const hint = REFUSAL_HINTS.find(([pattern]) => pattern.test(error.message))
  return hint ? new Error(`${error.message}\n  ${hint[1]}`) : error
}

run()
