# Agent Guidelines

## Project Overview

Public GitHub Action (`minitap-ai/minitest-trigger`) that triggers Minitap test runs from CI workflows. Authenticates via GitHub OIDC — no secrets needed.

## Architecture

- **`action.yml`** — GitHub Action manifest (inputs, outputs, runtime config)
- **`src/main.ts`** — Entry point: reads inputs → OIDC token → optional build upload → trigger run → set outputs
- **`src/api.ts`** — HTTP client with two functions: `uploadBuild()` (multipart form) and `triggerRun()` (JSON)
- **`dist/`** — ncc bundle, NOT committed to source. Built automatically by the release workflow

## API Contract

The action talks to the Minitap testing-service (see `../testing-service` for the server):

- `POST /api/v1/ci/builds/upload` — multipart form: `file`, `app_slug`, `commit_title`, `commit_sha` (optional override), `tenant_id` (optional). Returns `{ buildId, platform, appId }`
- `POST /api/v1/ci/run` — JSON: `{ appSlug, commitTitle, commitSha?, userStoryTypes?, iosBuildId?, androidBuildId?, tenantId?, prNumber?, prTitle? }`. Returns `{ batchId, status, appId, appSlug }`
- Auth: `Authorization: Bearer <oidc-token>` with audience `https://testing-service.minitap.ai`
- Commit SHA: the server defaults to the OIDC `sha` claim. For `pull_request` / `pull_request_target` events the action sends `pull_request.head.sha` (read from `GITHUB_EVENT_PATH`) as a `commit_sha` override, because the OIDC claim points at the ephemeral merge commit and is not addressable from the PR "Checks" tab. The server only honours the override for those PR events; for any other event the override is ignored.

## Tech Stack

- TypeScript (strict mode, ES2022, CommonJS)
- `@actions/core` for GitHub Actions runtime (inputs, outputs, OIDC, logging)
- `@actions/http-client` for HTTP requests
- `@vercel/ncc` for bundling into a single `dist/index.js`
- ESLint (flat config with typescript-eslint) + Prettier (no semicolons, single quotes)

## Commands

```bash
npm run build        # TypeScript compilation
npm run bundle       # ncc bundle to dist/
npm run lint         # ESLint
npm run format       # Prettier (write)
npm run format:check # Prettier (check only)
npm run all          # build + lint + format:check + bundle
```

## Workflows

- **CI** (`.github/workflows/ci.yml`) — Runs on push/PR to main: lint, format check, tsc build, ncc bundle (compile check only, no dist commit)
- **Release** (`.github/workflows/release.yml`) — On GitHub Release publish: builds `dist/`, commits it to the release tag, updates the `v1` major version tag

## Release Process

1. Create a GitHub Release with a semver tag (e.g., `v1.2.0`)
2. Release workflow builds and commits `dist/` to that tag
3. Updates `v1` tag to point to the new release
4. Users referencing `@v1` automatically get the latest

## Conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, `ci:`, `docs:`
- `dist/` is gitignored — never commit it manually
- All API field names use camelCase on the wire (testing-service uses Pydantic alias generation)
- Form fields (build upload) use snake_case since they're multipart form params, not JSON
