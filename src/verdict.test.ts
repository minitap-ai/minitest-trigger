import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as core from '@actions/core'
import { reportVerdict } from './verdict'
import type { RunResult } from './api'
import type { WaitOutcome } from './wait-for-result'

vi.mock('@actions/core', () => ({
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

const setOutput = vi.mocked(core.setOutput)
const setFailed = vi.mocked(core.setFailed)

const BATCH_URL = 'https://app.minitap.ai/runs/batch-1'

function verdict(result: RunResult): WaitOutcome {
  return {
    timedOut: false,
    result,
    batchId: 'batch-1',
    url: BATCH_URL,
    failedStories: result === 'failed' ? ['Checkout'] : [],
  }
}

function outputs(): Record<string, string> {
  return Object.fromEntries(setOutput.mock.calls) as Record<string, string>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reportVerdict', () => {
  const cases: Array<{
    outcome: WaitOutcome
    label: string
    expectedResult: string
    failsWhenGated: boolean
  }> = [
    {
      outcome: verdict('passed'),
      label: 'passed',
      expectedResult: 'passed',
      failsWhenGated: false,
    },
    {
      outcome: verdict('nothing_affected'),
      label: 'nothing_affected',
      expectedResult: 'nothing_affected',
      failsWhenGated: false,
    },
    {
      outcome: verdict('failed'),
      label: 'failed',
      expectedResult: 'failed',
      failsWhenGated: true,
    },
    {
      outcome: verdict('error'),
      label: 'error',
      expectedResult: 'error',
      failsWhenGated: true,
    },
    {
      outcome: { timedOut: true, url: BATCH_URL },
      label: 'a timeout',
      expectedResult: '',
      failsWhenGated: true,
    },
  ]

  for (const { outcome, label, expectedResult, failsWhenGated } of cases) {
    for (const failOnFailure of [true, false]) {
      it(`${label} with fail-on-failure ${failOnFailure} sets result "${expectedResult}" and ${failsWhenGated && failOnFailure ? 'fails' : 'does not fail'} the step`, () => {
        reportVerdict(outcome, { failOnFailure, waitTimeoutMinutes: 30 })

        expect(outputs()).toEqual({
          result: expectedResult,
          'batch-url': BATCH_URL,
        })
        expect(setFailed.mock.calls.length).toBe(
          failsWhenGated && failOnFailure ? 1 : 0,
        )
      })
    }
  }

  it('treats nothing_affected as a PASS: the gate must stay green when no scenario was impacted', () => {
    reportVerdict(verdict('nothing_affected'), {
      failOnFailure: true,
      waitTimeoutMinutes: 30,
    })

    expect(setFailed).not.toHaveBeenCalled()
    expect(outputs().result).toBe('nothing_affected')
  })

  it('reports the failing stories so the gate message names what broke', () => {
    reportVerdict(verdict('failed'), {
      failOnFailure: true,
      waitTimeoutMinutes: 30,
    })

    expect(setFailed.mock.calls[0][0]).toContain('Checkout')
  })
})
