/**
 * Refuse a bundle that cannot load itself.
 *
 * `ncc` does not fail when it cannot resolve a dependency. It emits a stub that
 * throws `Cannot find module` at *runtime* and exits 0, so `npm run bundle`
 * reports success while producing an artifact that dies on its first line.
 *
 * That shipped: renovate moved `@actions/core` to v3 and `@actions/http-client`
 * to v4, both ESM-only, which this CJS bundle cannot require. Lint, tests, tsc
 * and the bundle step were all green — the unit tests mock `@actions/core`, so
 * nothing ever loaded the real artifact — and the broken build went out as
 * v2.5.1 and force-moved the `v2` tag every consumer resolves.
 *
 * Two checks, because either alone would have missed it:
 *   1. no `webpackMissingModule` stubs in the emitted bundle;
 *   2. the bundle actually loads in a fresh process. A missing input is the
 *      expected outcome there; a MODULE_NOT_FOUND is not.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BUNDLE = 'dist/index.js'

const source = readFileSync(BUNDLE, 'utf8')
const stubs = [...source.matchAll(/Cannot find module '([^']+)'/g)].map(
  (m) => m[1],
)
if (stubs.length > 0) {
  console.error(
    `${BUNDLE} embeds unresolved module stub(s): ${[...new Set(stubs)].join(', ')}\n` +
      'ncc could not resolve these at bundle time — most often because a ' +
      'dependency moved to an ESM-only major that this CJS bundle cannot ' +
      'require. The action would fail on its first line.',
  )
  process.exit(1)
}

try {
  execFileSync(process.execPath, ['-e', `require('./${BUNDLE}')`], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
} catch (err) {
  const output = `${err.stdout ?? ''}${err.stderr ?? ''}`
  // Running outside a workflow, the action correctly stops on its first
  // required input. That is a loaded bundle, which is all this asserts.
  if (!output.includes('Input required and not supplied')) {
    console.error(`${BUNDLE} failed to load:\n${output}`)
    process.exit(1)
  }
}

console.log(`${BUNDLE} resolves every dependency and loads.`)
