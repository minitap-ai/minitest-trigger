# Minitap Trigger Tests Action

A GitHub Action that triggers your [Minitest](https://minitap.ai) suite from your CI workflow. It authenticates via GitHub OIDC, optionally uploads build artifacts, and kicks off test execution — all fire-and-forget. Results are reported back to your PR via GitHub Check Runs.

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
      - uses: minitap-ai/minitest-trigger@v1
        with:
          app-slug: my-app
```

## Inputs

| Input                | Required | Default                                  | Description                                                |
| -------------------- | -------- | ---------------------------------------- | ---------------------------------------------------------- |
| `app-slug`           | Yes      | —                                        | The Minitest app slug to test                              |
| `flow-types`         | No       | —                                        | Comma-separated flow types to run (e.g., `login,checkout`) |
| `ios-build-path`     | No       | —                                        | Path to the iOS `.ipa` file to upload                      |
| `android-build-path` | No       | —                                        | Path to the Android `.apk` file to upload                  |
| `tenant-id`          | No       | —                                        | Tenant ID (required if repo is linked to multiple tenants) |
| `api-url`            | No       | `https://testing-service.app.minitap.ai` | Override API base URL                                      |

## Outputs

| Output     | Description                           |
| ---------- | ------------------------------------- |
| `batch-id` | The ID of the triggered test batch    |
| `status`   | Initial status of the triggered batch |

## How It Works

1. **OIDC Authentication** — Requests a GitHub OIDC token scoped to the Minitap API. No secrets to manage!
2. **Build Upload** (optional) — Uploads iOS `.ipa` and/or Android `.apk` files to Minitap
3. **Trigger Run** — Calls the Minitap CI API with your configuration
4. **Fire & Forget** — The action exits immediately. Results are reported back via GitHub Check Runs

## Examples

### Run specific flow types

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    flow-types: login,checkout,onboarding
```

### Upload iOS and Android builds

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    ios-build-path: ./build/MyApp.ipa
    android-build-path: ./build/app-release.apk
```

### Multi-tenant setup

```yaml
- uses: minitap-ai/minitest-trigger@v1
  with:
    app-slug: my-app
    tenant-id: tenant_abc123
```

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
