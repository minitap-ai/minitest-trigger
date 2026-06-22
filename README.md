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
| `run-web`            | No       | `false`                                  | Run the web lane using the app's configured default web targets. See [Web runs](#web-runs). |
| `web-targets`        | No       | —                                        | Explicit web targets, comma-separated `<browser>:<viewport>` (e.g. `chrome:desktop,safari:mobile`). Enables the web lane on its own. |
| `web-url`            | No       | —                                        | Per-run web URL override (e.g. a PR preview deployment). Applies when `run-web` or `web-targets` is set. |
| `user-story-types`   | No       | —                                        | Comma-separated user story types to run (e.g., `login,checkout`)             |
| `tenant-id`          | No       | —                                        | Tenant ID (required if repo is linked to multiple tenants)                   |
| `api-url`            | No       | `https://testing-service.app.minitap.ai` | Override API base URL                                                        |
| `cancel-previous-runs` | No     | `true`                                   | Cancel previous in-flight batches on the same source branch when it matches the app's release branch patterns. See [Cancelling previous runs](#cancelling-previous-runs). |

> By default, Minitest builds your app for both platforms. Set `run-ios: false` or `run-android: false` to skip a platform, or supply a `*-build-path` to use a build you've already produced.

## Outputs

| Output     | Description                           |
| ---------- | ------------------------------------- |
| `batch-id` | The ID of the triggered test batch    |
| `status`   | Initial status of the triggered batch |

## How It Works

1. **OIDC Authentication** — Requests a GitHub OIDC token scoped to the Minitap API. No secrets to manage!
2. **Validate Builds** — If you supplied any build paths, the action validates the artifacts (see below).
3. **Upload Builds** — Uploads your supplied builds to Minitap (`.app` bundles are automatically packaged into `.ipa`).
4. **Trigger Run** — Calls the Minitap CI API. For any enabled platform without a supplied build, Minitest builds the app for this commit on your behalf.
5. **Fire & Forget** — The action exits immediately. Results are reported back via GitHub Check Runs.

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

The web lane has no build step, so there's nothing to upload. Point it at a URL with `web-url` (for example a PR preview deployment); otherwise the app's configured web URL is used.

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
