# https://getrunpass.com/

Frontend and backend for https://getrunpass.com/

This app lets you create passbooks for your iPhone with your parkrun barcode.

[![publish cloudflare worker](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml/badge.svg)](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml)
[![monitor prod apple passbook](https://github.com/run-pass/run-pass/actions/workflows/prod-monitor.yml/badge.svg)](https://github.com/run-pass/run-pass/actions/workflows/prod-monitor.yml)

A daily GitHub Actions monitor checks the production Apple Wallet pass endpoint at 07:00 UTC and relies on native workflow failure notifications.

## Releases and previews

Both the Worker and the Pages site are released from GitHub Actions:

| What | Workflow | Trigger |
|---|---|---|
| Worker (prod-api) | `worker-publish.yml` | push to `main` |
| Frontend (getrunpass.com) | `pages-publish.yml` | push to `main` touching `frontend/**` |
| PR preview (site + API) | `pr-preview.yml` | pull request opened/updated |
| PR preview teardown | `pr-preview-cleanup.yml` | pull request closed |

Each pull request gets its own Worker (`runpass-pr-<n>` on `workers.dev`) and its
own Pages deployment, and the preview site is built to talk to the preview
Worker rather than production. The API base URL is injected at build time from
`API_BASE_URL`; when unset the build targets `https://prod-api.getrunpass.com`.

**One-time setup:** the Cloudflare Pages GitHub integration must be disconnected
(Workers & Pages -> `run-pass-github-io` -> Settings -> Builds), otherwise it and
`pages-publish.yml` will both deploy on every push to `main`. `CF_API_TOKEN` also
needs Cloudflare Pages edit permission in addition to its existing Workers scope.
