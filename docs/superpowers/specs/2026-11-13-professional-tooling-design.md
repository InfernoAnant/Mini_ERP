# Professional Tooling — Design (short)

Date: 2026-11-13 · Status: approved by the user in chat

## Why
This is a resume showcase. A reviewer's first five minutes on GitHub decide whether it looks team-built: green CI, enforced code style, one-command setup, automated end-to-end tests and a README that shows the product.

## Goals (user-approved)
1. **CI** (GitHub Actions, Node 22) on every push and PR: lint, type-check, server tests against a Postgres service, client build, Playwright e2e, and a Docker Compose build. The README shows the badge.
2. **ESLint and Prettier** for both apps (one root flat config), `lint-staged` on a Husky pre-commit hook, and `.editorconfig`. Existing code is reformatted once in a single `style:` commit.
3. **Docker:** a multi-stage API image, an nginx web image proxying `/api`, and `docker-compose.yml` running Postgres, the API and the web app, with the demo auto-seeded on first start.
4. **Node 22** pinned with `.nvmrc` and `engines`.
5. **Playwright e2e:** the full demo flow through the real UI (sale → MO → PO → receipt → production → delivery → 100%), plus role-based menu checks.
6. **README:** badge, screenshots captured by Playwright, an architecture diagram and "Run with Docker".
7. **Push `main` to `github.com/InfernoAnant/Mini_ERP`** (public) once CI is in place. The user approved this.

## Non-goals / user actions
- Installing Docker Desktop and nvm-windows, and moving the folder out of OneDrive: these need admin rights or would break the session, so the user does them. Exact commands are given at the end.
- Tier 2/3 items not chosen this round: OpenAPI, helmet/rate limiting, client unit tests, ADRs, UX polish.

## Approaches (decided)
- **Tooling location:** a root `package.json` holds the shared dev tooling (ESLint, Prettier, Husky, lint-staged, Playwright), while the apps keep their own runtime deps. Chosen over per-app ESLint installs to avoid duplicated configs and versions.
- **Demo seeding in Docker:** an `AUTO_SEED=true` env var makes the API seed the demo on start when the database has no users. Chosen over a separate seed container (which needs `tsx` and dev deps in the image). It also helps the Render deploy.
- **E2E database:** e2e runs against the dev/CI database and starts from `POST /api/demo/reset`, so the flow is deterministic. The unit-test DB stays separate.
- **README media:** PNG screenshots captured by a Playwright script. A GIF needs ffmpeg, so it's skipped (builder's call).

## Constraints
No new dependencies beyond the approved list (exact versions in the plan). No business logic changes. CLAUDE.md rules still apply.
