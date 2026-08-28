import * as core from '@actions/core'
import type { VerdictReached, WaitOutcome } from './wait-for-result'

export interface ReportVerdictOptions {
  failOnFailure: boolean
  waitTimeoutMinutes: number
}

function reportGateFailure(failOnFailure: boolean, message: string): void {
  if (failOnFailure) {
    core.setFailed(message)
  } else {
    core.warning(message)
  }
}

function describeFailedRun(outcome: VerdictReached): string {
  const { failedStories } = outcome
  let message =
    outcome.result === 'error'
      ? 'The Minitest run errored before reaching a verdict.'
      : failedStories.length
        ? `The Minitest run failed — ${failedStories.length} failing ${failedStories.length === 1 ? 'story' : 'stories'}: ${failedStories.join(', ')}`
        : 'The Minitest run failed.'

  if (outcome.url) {
    message += `\n${outcome.url}`
  }
  return message
}

/**
 * Turn a wait outcome into the action's observable result: the `result` and
 * `batch-url` outputs, and whether the step fails.
 *
 * `nothing_affected` is a PASS — the impact analysis found no scenario to run,
 * so the gate must stay green.
 */
export function reportVerdict(
  outcome: WaitOutcome,
  options: ReportVerdictOptions,
): void {
  const { failOnFailure, waitTimeoutMinutes } = options

  if (outcome.timedOut) {
    core.setOutput('result', '')
    core.setOutput('batch-url', outcome.url ?? '')
    reportGateFailure(
      failOnFailure,
      `Timed out after ${waitTimeoutMinutes} minutes waiting for a verdict.${outcome.url ? `\n${outcome.url}` : ''}`,
    )
    return
  }

  core.setOutput('result', outcome.result)
  core.setOutput('batch-url', outcome.url ?? '')

  if (outcome.result === 'passed' || outcome.result === 'nothing_affected') {
    core.info(
      outcome.result === 'nothing_affected'
        ? 'No scenario was impacted by this commit — nothing to run.'
        : 'The Minitest run passed.',
    )
    return
  }

  reportGateFailure(failOnFailure, describeFailedRun(outcome))
}
