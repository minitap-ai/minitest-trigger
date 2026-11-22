import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../script-jobs/submit.sh')
const RUN_URL = 'https://app.minitap.ai/apps/app-1/test/script-runs/run-1'

function unit(name: string, status: string, failureMessage?: string) {
  return {
    unit: `flows/${name}.yaml`,
    state: status,
    cases: [{ name, status, failureMessage }],
  }
}

function job(status: string, units: object[]) {
  return {
    jobId: 'job-1',
    runName: 'CI #42',
    framework: 'maestro',
    platform: 'android',
    status,
    units,
    runUrl: RUN_URL,
  }
}

/** Runs submit.sh with a fake `uvx` that records its arguments and answers like the CLI. */
function run(
  answer: object | null,
  cliExit: number,
  env: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'script-jobs-'))
  const out = answer === null ? '' : JSON.stringify(answer)
  writeFileSync(join(dir, 'answer.json'), out)
  writeFileSync(
    join(dir, 'uvx'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${dir}/args"\ncat "${dir}/answer.json"\nexit ${cliExit}\n`,
  )
  chmodSync(join(dir, 'uvx'), 0o755)
  writeFileSync(join(dir, 'output'), '')
  writeFileSync(join(dir, 'summary'), '')
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_OUTPUT: join(dir, 'output'),
      GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      INPUT_APP_ID: 'app-1',
      INPUT_FRAMEWORK: 'maestro',
      INPUT_TESTS: 'flows',
      INPUT_BUILD_ID: 'build-1',
      INPUT_RUN_NAME: 'CI #42',
      INPUT_COMMIT_SHA: 'abc123',
      INPUT_BRANCH: '',
      INPUT_TIMEOUT_MINUTES: '30',
      INPUT_FAIL_ON_FAILURE: 'true',
      INPUT_CLI_VERSION: '0.56.0',
      ...env,
    },
  })
  return {
    exit: result.status,
    log: result.stdout,
    args: readFileSync(join(dir, 'args'), 'utf8').trim().split('\n'),
    outputs: readFileSync(join(dir, 'output'), 'utf8'),
    summary: readFileSync(join(dir, 'summary'), 'utf8'),
  }
}

describe('script-jobs action', () => {
  it('runs the pinned CLI with the inputs and passes when every test passed', () => {
    const r = run(job('passed', [unit('sign_in', 'passed')]), 0)

    expect(r.exit).toBe(0)
    expect(r.args.slice(0, 3)).toEqual([
      '--quiet',
      '--from',
      'minitest-cli==0.56.0',
    ])
    expect(r.args.slice(3).join(' ')).toBe(
      'minitest --json --app app-1 script-runs submit --framework maestro --tests flows ' +
        '--build-id build-1 --timeout 1800 --run-name CI #42 --commit-sha abc123',
    )
    expect(r.outputs).toContain('job-id=job-1\n')
    expect(r.outputs).toContain(`run-url=${RUN_URL}\n`)
    expect(r.outputs).toContain('status=passed\n')
    expect(r.summary).toContain(`[Open the run in Minitest](${RUN_URL})`)
  })

  it('fails the step on a failed test and shows its reason in the summary', () => {
    const failed = unit(
      'checkout',
      'failed',
      'Assertion is false: "$28.99" | is visible',
    )
    const r = run(job('failed', [unit('sign_in', 'passed'), failed]), 1)

    expect(r.exit).toBe(1)
    expect(r.outputs).toContain('status=failed\n')
    expect(r.summary).toContain(
      '| flows/checkout.yaml | checkout | ❌ failed | Assertion is false: "$28.99" \\| is visible |',
    )
    expect(r.log).toContain('failed   flows/checkout.yaml checkout')
  })

  it('reports the failure without failing the step when fail-on-failure is off', () => {
    const r = run(job('failed', [unit('checkout', 'failed', 'boom')]), 1, {
      INPUT_FAIL_ON_FAILURE: 'false',
    })

    expect(r.exit).toBe(0)
    expect(r.outputs).toContain('status=failed\n')
  })

  it('says there is no verdict when Minitap could not run the job', () => {
    const r = run(null, 7)

    expect(r.exit).toBe(7)
    expect(r.outputs).toBe('status=error\n')
    expect(r.summary).toContain(
      'Minitap could not run the job or the wait timed out (exit 7)',
    )
  })
})
