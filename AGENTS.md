# Agent Guidelines

## Project Overview

Public GitHub Action (`minitap-ai/minitest-trigger`) that triggers Minitap test runs from CI workflows. Authenticates via GitHub OIDC — no secrets needed.

## Architecture

- **`action.yml`** — GitHub Action manifest (inputs, outputs, runtime config)
- **`src/main.ts`** — Entry point: reads inputs → OIDC token → optional build upload → trigger run → set outputs → optionally wait for the verdict
- **`src/api.ts`** — HTTP client with three functions: `uploadBuild()` (multipart form), `triggerRun()` (JSON) and `getCiStatus()` (verdict polling)
- **`src/wait-for-result.ts`** — `waitForVerdict()`: polls `getCiStatus()` until the run reaches a verdict or the timeout elapses. Opt-in via the `wait-for-result` input
- **`dist/`** — ncc bundle, NOT committed to source. Built automatically by the release workflow

## API Contract

The action talks to the Minitap testing-service (see `../testing-service` for the server):

- `POST /api/v1/ci/builds/upload` — multipart form: `file`, `app_slug`, `commit_title`, `commit_sha` (optional override), `tenant_id` (optional). Returns `{ buildId, platform, appId }`
- `POST /api/v1/ci/run` — JSON: `{ appSlug, commitTitle, commitSha?, userStoryTypes?, iosBuildId?, androidBuildId?, tenantId?, prNumber?, prTitle? }`. Returns `{ batchId, status, appId, appSlug }`
- `GET /api/v1/ci/status` — query params in **snake_case**: `app_slug`, `commit_sha`, `tenant_id` (optional). Returns `{ state, result, batchId, appId, appSlug, url, failedStories }`. `state` is `pending` (no batch yet, analysis still running) / `running` / `completed`; `result` is non-null only when completed and is one of `passed`, `failed`, `error`, `nothing_affected`. **`nothing_affected` is a PASS** — nothing was impacted, so no batch was created; it must never be treated as a failure or a timeout.
- Auth: `Authorization: Bearer <oidc-token>` with audience `https://testing-service.minitap.ai`
- Commit SHA: the server defaults to the OIDC `sha` claim. The action overrides it with the PR head SHA on PR-context events, because the claim points at the ephemeral merge commit (`pull_request`) or the default-branch head (`issue_comment`) and is not addressable from the PR "Checks" tab. On `pull_request` / `pull_request_target` the SHA and refs come from `GITHUB_EVENT_PATH`; on `issue_comment` the payload has neither, so `src/pr-context.ts` fetches the PR via the REST API using the `github-token` input. The server only honours the override for those three events; for any other event it is ignored.

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
- Form fields (build upload) and query params (`GET /ci/status`) use snake_case since they're not JSON bodies
