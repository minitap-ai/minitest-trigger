#!/usr/bin/env bash
# Runs `minitest script-runs submit`, then turns its JSON verdict into the step outputs and the
# job summary. The CLI exits 0 when every test passed, 1 when one failed and 7 when Minitap could
# not run some tests (or the wait timed out).
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# MINITEST_CLI_FROM lets a workflow run an unreleased CLI (a git URL); customers pin cli-version.
cli_from="${MINITEST_CLI_FROM:-minitest-cli${INPUT_CLI_VERSION:+==$INPUT_CLI_VERSION}}"

args=(--json --app "$INPUT_APP_ID" script-runs submit
  --framework "$INPUT_FRAMEWORK" --tests "$INPUT_TESTS" --build-id "$INPUT_BUILD_ID"
  --timeout "$((INPUT_TIMEOUT_MINUTES * 60))")
[ -n "${INPUT_MODEL:-}" ] && args+=(--model "$INPUT_MODEL")
[ -n "${INPUT_OS_VERSION:-}" ] && args+=(--os-version "$INPUT_OS_VERSION")
[ -n "${INPUT_RUN_NAME:-}" ] && args+=(--run-name "$INPUT_RUN_NAME")
[ -n "${INPUT_COMMIT_SHA:-}" ] && args+=(--commit-sha "$INPUT_COMMIT_SHA")
[ -n "${INPUT_BRANCH:-}" ] && args+=(--branch "$INPUT_BRANCH")

# Values for the tests: masked in the log, handed to the CLI in a private file, never on its
# command line, and the file is gone when the step ends.
if [ -n "${INPUT_ENV:-}" ]; then
  env_file="$(mktemp)"
  chmod 600 "$env_file"
  trap 'rm -f "$env_file"' EXIT
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    value="${line#*=}"
    if [ "$value" != "$line" ] && [ -n "$value" ]; then
      echo "::add-mask::$value"
      unquoted="${value#[\"\']}" && unquoted="${unquoted%[\"\']}"
      [ "$unquoted" != "$value" ] && [ -n "$unquoted" ] && echo "::add-mask::$unquoted"
    fi
    printf '%s\n' "$line" >>"$env_file"
  done <<<"$INPUT_ENV"
  args+=(--env-file "$env_file")
fi

verdict="$(mktemp)"
echo "Running the $INPUT_FRAMEWORK suite in $INPUT_TESTS on Minitap devices and waiting for the verdict..."
uvx --quiet --from "$cli_from" minitest "${args[@]}" >"$verdict"
code=$?

python3 "$here/summary.py" "$verdict" "$code"

if [ "$code" -ne 0 ] && [ "${INPUT_FAIL_ON_FAILURE:-true}" = "true" ]; then
  exit "$code"
fi
exit 0
