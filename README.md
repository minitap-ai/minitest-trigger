# Minitap Trigger Tests Action

A GitHub Action that triggers your [Minitest](https://minitap.ai) suite from your CI workflow. It authenticates via GitHub OIDC, uploads your build artifacts, and kicks off test execution — all fire-and-forget. Results are reported back to your PR via GitHub Check Runs.

## Quick Start

```yaml
name: Run Minitest Suite
on:
  push:
    tags: ['v*']

permissions:
  id-token: write # Required for OIDC authentication

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      # Build your app for simulators/emulators (your build steps here)

      - uses: minitap-ai/minitest-trigger@v1
        with:
          app-slug: my-app
          ios-build-path: ./build/MyApp.app
          android-build-path: ./build/app-debug.apk
```

## Inputs

| Input                | Required | Default                                  | Description                                                                  |
| -------------------- | -------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `app-slug`           | Yes      | —                                        | The Minitest app slug to test                                                |
| `run-ios`            | No       | `true`                                   | Run tests on iOS. Minitest builds the app when no `ios-build-path` is given. |
| `run-android`        | No       | `true`                                   | Run tests on Android. Minitest builds the app when no path is given.         |
| `ios-build-path`     | No       | —                                        | Pre-built iOS bundle (`.app` directory or `.ipa` file). Optional.            |
| `android-build-path` | No       | —                                        | Pre-built Android `.apk` (must target x86-64). Optional.                     |
| `run-web`            | No       | `false`                                  | Run the web lane. For a web app linked to a GitHub repo, Minitest builds and serves the commit this workflow runs on (no `web-url` needed); otherwise it tests the app's configured web URL. See [Web runs](#web-runs). |
| `web-targets`        | No       | —                                        | Explicit web targets, comma-separated `<browser>:<viewport>` (e.g. `chrome:desktop,safari:mobile`). Enables the web lane on its own. |
| `web-url`            | No       | —                                        | Per-run web URL override (e.g. a PR preview deployment). When set, the web lane tests this URL instead of building the commit. Applies when `run-web` or `web-targets` is set. |
| `user-story-types`   | No       | —                                        | Comma-separated user story types to run (e.g., `login,checkout`)             |
| `scope`              | No       | —                                        | `affected` (impacted since the last release tag), `pr-affected` (impacted by this pull request, see [Scoping a run to a pull request](#scoping-a-run-to-a-pull-request)) or `full`. Ignored when `user-stories` / `user-story-types` is set. |
| `tenant-id`          | No       | —                                        | Tenant ID (required if repo is linked to multiple tenants)                   |
| `api-url`            | No       | `https://testing-service.app.minitap.ai` | Override API base URL                                                        |
| `github-token`       | No       | `${{ github.token }}`                    | Used on `issue_comment` events to resolve the pull request behind the comment so the run is attached to it. Needs `pull-requests: read`. See [Preview deployments posted as PR comments](#preview-deployments-posted-as-pr-comments). |
| `cancel-previous-runs` | No     | `true`                                   | Cancel previous in-flight batches on the same source branch when it matches the app's release branch patterns. See [Cancelling previous runs](#cancelling-previous-runs). |
| `wait-for-result`      | No     | `false`                                  | Block until the run reaches a verdict instead of exiting immediately. See [Gating a release on the suite](#gating-a-release-on-the-suite). |
| `wait-timeout-minutes` | No     | `45`                                     | How long to wait for a verdict when `wait-for-result` is enabled.            |
| `fail-on-failure`      | No     | `false`                                  | Fail the step when the verdict is a failure. Requires `wait-for-result: true`. |

> By default, Minitest builds your app for both platforms. Set `run-ios: false` or `run-android: false` to skip a platform, or supply a `*-build-path` to use a build you've already produced.

## Outputs

| Output      | Description                           |
| ----------- | ------------------------------------- |
| `batch-id`  | The ID of the triggered test batch, empty when no batch was created |
| `status`    | Initial status of the triggered batch |
| `result`    | The verdict when `wait-for-result` is enabled: `passed`, `failed`, `error` or `nothing_affected`. Empty otherwise (including on timeout). |
| `batch-url` | Link to the run in the Minitest dashboard, when one was created |

## How It Works

1. **OIDC Authentication** — Requests a GitHub OIDC token scoped to the Minitap API. No secrets to manage!
2. **Validate Builds** — If you supplied any build paths, the action validates the artifacts (see below).
3. **Upload Builds** — Uploads your supplied builds to Minitap (`.app` bundles are automatically packaged into `.ipa`).
4. **Trigger Run** — Calls the Minitap CI API. For any enabled platform without a supplied build, Minitest builds the app for this commit on your behalf.
5. **Fire & Forget** — The action exits immediately. Results are reported back via GitHub Check Runs. Set `wait-for-result: true` to block on the verdict instead, so a deploy can be gated on it — see [Gating a release on the suite](#gating-a-release-on-the-suite).

## Build Requirements

By default, Minitest builds your app for both platforms — you don't need to supply anything beyond `app-slug`. Provide a build path only when you want to use an artifact you've already produced (e.g., to skip a redundant build step in your workflow). Builds you supply must target simulators / emulators.

### iOS

Provide a **simulator** `.app` bundle or a `.ipa` file.

| Format | Description                                                     |
| ------ | --------------------------------------------------------------- |
| `.app` | Simulator bundle directory (automatically packaged into `.ipa`) |
| `.ipa` | IPA file (uploaded as-is)                                       |

To build for the iOS Simulator with `xcodebuild`:

```bash
xcodebuild build \
  -scheme MyApp \
  -sdk iphonesimulator \
  -configuration Debug \
  -derivedDataPath ./build
# Output: ./build/Build/Products/Debug-iphonesimulator/MyApp.app
```

### Android

Provide a **`.apk`** file built for **x86-64** emulators. The action inspects the APK and verifies it contains native libraries for the `x86_64` architecture (`lib/x86_64/`).

To build an x86-64 debug APK with Gradle, configure your app's `build.gradle`:

```groovy
// app/build.gradle
android {
  defaultConfig {
    ndk { abiFilters 'x86_64' }
  }
}
```

Then build:

```bash
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

> **Note:** If your APK only contains `arm64-v8a` or `armeabi-v7a` libraries, the action will fail with a clear error telling you which architectures were found.

## Web runs

`run-ios`, `run-android`, and the web inputs each select a lane, and lanes are additive: you can run just the web lane, just one native lane, or any mix.

There are two ways to include the web lane:

- **`run-web: true`** runs the app's configured default web targets (set per app in Minitest).
- **`web-targets`** runs an explicit list and includes the web lane on its own (you don't also need `run-web`).

For a web app linked to a GitHub repo (set in App Settings), the web lane builds and serves the commit this workflow runs on and tests against that build. No `web-url` is required, and this holds even when the app also has a configured web URL: the linked-repo lane tests the commit, not the deployment. Supply `web-url` (for example a PR preview deployment) only to test a separately-deployed URL instead of the commit. For a web app with only a configured URL and no linked repo, the lane tests that configured URL.

`web-targets` is a comma-separated list of `<browser>:<viewport>` tokens. The action maps each token to a target:

| Token             | Runs as                     |
| ----------------- | --------------------------- |
| `safari:mobile`   | iOS Safari (mobile web)     |
| `chrome:mobile`   | Android Chrome (mobile web) |
| `chrome:tablet`   | Tablet web (Chrome)         |
| `firefox:tablet`  | Tablet web (Firefox)        |
| `chrome:desktop`  | Desktop web (Chrome)        |
| `firefox:desktop` | Desktop web (Firefox)       |

Other combinations (such as `firefox:mobile` or `safari:desktop`) are rejected with a clear error.

## Examples

### Default — Minitest builds for both platforms

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
```

### iOS only

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    run-android: false
```

### Android only, with your own build

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    run-ios: false
    android-build-path: ./app/build/outputs/apk/debug/app-debug.apk
```

### Bring your own iOS build, let Minitest build Android

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    ios-build-path: ./build/Build/Products/Debug-iphonesimulator/MyApp.app
```

### Both platforms with specific user story types

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    user-story-types: login,checkout,onboarding
```

### Web app, configured defaults

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    run-web: true
```

### Web app, explicit targets against a preview URL

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    web-targets: chrome:desktop,safari:mobile
    web-url: https://pr-142.preview.example.com
```

### Preview deployments posted as PR comments

Vercel, Netlify & co. announce each preview deployment as a comment on the pull request. Trigger the web lane from that comment and the batch is attached to the PR — its check run shows up in the PR's Checks tab, and — when the PR head branch matches one of the app's release branch patterns — `cancel-previous-runs` supersedes the batch from the previous preview.

```yaml
name: Minitest preview

on:
  issue_comment:
    types: [created, edited]

permissions:
  id-token: write
  pull-requests: read

jobs:
  minitest:
    if: github.event.issue.pull_request != null && github.event.comment.user.login == 'vercel[bot]'
    runs-on: ubuntu-latest
    steps:
      - id: parse
        run: |
          url="$(grep -Eo 'https://[A-Za-z0-9._-]+\.vercel\.app[^ )"'"'"']*' <<< "$COMMENT" | head -n1)"
          [ -n "$url" ] || exit 1
          echo "url=${url%/}" >> "$GITHUB_OUTPUT"
        env:
          COMMENT: ${{ github.event.comment.body }}

      - uses: minitap-ai/minitest-trigger@v1
        with:
          app-slug: my-app
          run-ios: false
          run-android: false
          web-targets: chrome:desktop
          web-url: ${{ steps.parse.outputs.url }}
          scope: pr-affected
```

Two caveats: `issue_comment` workflows only run from the default branch (the file must be merged before commenting does anything), and a preview behind Vercel Deployment Protection serves an SSO page rather than your app.

## Scoping a run to a pull request

`scope: pr-affected` runs only the scenarios the pull request's code changes could impact, instead of the whole suite. The impact analysis is the one already powering the "Run affected" checkbox on Minitest's pull request comment, so both entry points always agree on what "affected" means.

It needs the Minitap GitHub App installed on the repository — that is what observes the pull request and computes the analysis — and a pull request context (a `pull_request` event, or an `issue_comment` on a PR with `github-token` set).

Four outcomes, all non-fatal:

| Situation | What runs |
| --- | --- |
| The analysis is ready | Only the impacted scenarios |
| The analysis is still computing | The batch is created and parked; it starts, scoped, as soon as the analysis lands |
| No analysis exists (no GitHub App, or no PR context) | The whole suite, with a warning annotation |
| The analysis found nothing impacted | Nothing — no batch is created, `batch-id` is empty, and a warning explains why |

### Multi-tenant setup

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    tenant-id: tenant_abc123
```

## Cancelling previous runs

When you repeatedly push to the same release branch (e.g., reopening a release PR with a fix), older test batches that are still pending or running pile up. The `cancel-previous-runs` input (enabled by default) tells the server to cancel previous in-flight CI batches for the same source branch.

Cancellation is scoped:

- **Same source branch only** — matched on the PR head branch (`pull_request` events) or the branch ref for `push` / `workflow_dispatch` / `schedule` / `merge_group`.
- **Release branches only** — the branch must match one of the app's configured `release_branch_patterns` (gitignore-style; configured per app in Minitest).
- **CI-triggered only** — only batches triggered by this GitHub Action are cancelled. Webapp, Slack, or API-triggered runs are unaffected.

No-ops:

- Tag pushes (`refs/tags/*`).
- Branches that don't match a configured release pattern.
- Events where the branch can't be determined (e.g., PR event payload missing).

Opt out with `cancel-previous-runs: false`.

## Gating a release on the suite

By default the action is fire-and-forget: it triggers the run and exits, and the results land later as a GitHub Check Run. That is the right behaviour for a PR check, but it means a deploy job can ship before the suite has said anything.

Set `wait-for-result: true` to block until the run reaches a verdict, and `fail-on-failure: true` to turn that verdict into a red step. Everything downstream then gates on it with `needs:`.

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  id-token: write

jobs:
  minitest-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: minitap-ai/minitest-trigger@v1
        id: minitest
        with:
          app-slug: my-app
          scope: affected
          wait-for-result: true
          fail-on-failure: true
          wait-timeout-minutes: 60

  deploy:
    needs: minitest-gate
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/deploy.sh
```

`deploy` runs only once `minitest-gate` is green. If the suite fails, the job goes red and every job that `needs:` it is skipped — nothing ships.

### What counts as a pass

| Verdict (`result` output) | Gate |
| --- | --- |
| `passed` | ✅ Passes — every scenario passed |
| `nothing_affected` | ✅ **Passes** — the impact analysis found no scenario affected by this commit, so no batch was created. A no-op release is not a failure and must not block the deploy. |
| `failed` | ❌ Fails — the step message names the failing stories and links the run |
| `error` | ❌ Fails — the run errored or was cancelled, so there is no trustworthy verdict |

If the timeout elapses first, `result` is empty and the step fails with a timeout message (or warns, when `fail-on-failure` is false). Raise `wait-timeout-minutes` for suites that legitimately run longer than 45 minutes.

### Warn without blocking

Leave `fail-on-failure` at its default to observe the verdict without gating on it. The step stays green and a failing run is surfaced as a warning annotation, while `result` and `batch-url` still carry the outcome for later steps:

```yaml
- uses: minitap-ai/minitest-trigger@v1
  id: minitest
  with:
    app-slug: my-app
    wait-for-result: true

- run: echo "Verdict was ${{ steps.minitest.outputs.result }} — ${{ steps.minitest.outputs.batch-url }}"
```

`fail-on-failure: true` without `wait-for-result: true` is a configuration error and fails the step immediately: there is no verdict to fail on.

## Prerequisites

Your workflow **must** have the `id-token: write` permission for OIDC authentication to work:

```yaml
permissions:
  id-token: write
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Lint
npm run lint

# Bundle for distribution (local testing only — CI builds on release)
npm run bundle

# Run all checks
npm run all
```

### Releasing

1. Create a [GitHub Release](https://github.com/minitap-ai/minitest-trigger/releases/new) with a semver tag (e.g., `v1.0.0`)
2. The release workflow automatically builds `dist/`, commits it, and updates the `v1` major version tag
3. Users referencing `@v1` get the latest release automatically

## License

MIT
