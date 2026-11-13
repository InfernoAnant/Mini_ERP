# Professional Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CI, lint/format, Docker Compose, a Node 22 pin, Playwright e2e and README polish, then push to GitHub with green CI.

**Architecture:** A root `package.json` holds the shared dev tooling. `server/` and `client/` are unchanged apart from lint fixes and an `AUTO_SEED` start hook. GitHub Actions runs every check on Node 22 with a Postgres service.

**Tech Stack:** Existing stack plus the approved dev dependencies below.

**Spec:** `docs/superpowers/specs/2026-11-13-professional-tooling-design.md`

## Global Constraints
- Approved root devDependencies (exact): `eslint@9.17.0 @eslint/js@9.17.0 typescript-eslint@8.18.2 eslint-plugin-react-hooks@5.1.0 eslint-plugin-react-refresh@0.4.16 globals@15.14.0 eslint-config-prettier@9.1.0 prettier@3.4.2 husky@9.1.7 lint-staged@15.2.11 @playwright/test@1.49.1`. Playwright's Chromium download is approved.
- Docker base images: `node:22-bookworm-slim`, `nginx:1.27-alpine`, `postgres:17-alpine`.
- CI Node: 22.12.0. `.nvmrc`: `22.12.0`.
- No business-logic changes. Lint fixes must not change behavior: the server suite (124) stays green and the client builds.
- Prettier: `singleQuote`, `printWidth: 130`, `trailingComma: 'all'`, `semi: true` (closest to the existing style).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **The reformat commit changes behavior:** the full server suite and client build must pass right after the `style:` commit. → Task 1.
2. **The Docker API image misses Prisma's engine for Debian:** `binaryTargets` must include `debian-openssl-3.0.x`. → Task 2, checked in CI with `docker compose build`.
3. **`AUTO_SEED` re-seeds a non-empty DB:** it must only seed when the user count is 0. → Task 2 unit test.
4. **The e2e run is flaky on demo-reset throttling (429):** the e2e test resets once per run and tolerates 429. → Task 3.
5. **CI e2e can't reach the API:** the Playwright `webServer` starts both servers, and Vite proxies `/api`. → Task 4 is green on GitHub.

---

### Task 1: Node pin, ESLint, Prettier, hooks
**Files:** Create `package.json` (root: name `mini-erp`, private, scripts `lint`, `format`, `format:check`, `typecheck`, `test`, `test:e2e`, `prepare: husky`), `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.nvmrc`, `.husky/pre-commit` (`npx lint-staged`), with `lint-staged` set to `{"*.{ts,tsx,js}": ["eslint --fix", "prettier --write"], "*.{json,md,yml,css}": ["prettier --write"]}`. Modify `client/package.json` engines `">=20 <23"`, `.gitignore` (`client/tsconfig.tsbuildinfo`, `test-results/`, `playwright-report/`) and untrack `client/tsconfig.tsbuildinfo`.
- ESLint: `@eslint/js` recommended plus `typescript-eslint` recommended for `**/*.{ts,tsx}`; react-hooks and react-refresh for `client/src`; Node globals for `server`; `@typescript-eslint/no-explicit-any: error`; `no-unused-vars` via TS with `argsIgnorePattern: '^_'`; ignores `**/dist`, `**/node_modules`, `venv`, `server/prisma/migrations`; `eslint-config-prettier` last.
- [ ] Step 1: Install the root devDeps (exact list). Expected: success.
- [ ] Step 2: `npx eslint .`. Fix every error without changing behavior (ledger each rule disabled inline, with its reason).
- [ ] Step 3: `npx prettier --write .`, then `npm run lint && npm run format:check`. Expected: 0 errors.
- [ ] Step 4: `cd server && npm test` (124 pass) and `cd client && npm run build` (success).
- [ ] Step 5: Commit `chore: eslint, prettier, husky, node 22 pin`, then commit the reformat separately as `style: format codebase with prettier`.

### Task 2: Docker and auto-seed
**Files:** Create `server/Dockerfile`, `client/Dockerfile`, `client/nginx.conf`, `docker-compose.yml`, `.dockerignore` (in each app). Modify `server/src/index.ts` (call `maybeAutoSeed()` before `listen`), `server/prisma/schema.prisma` (`binaryTargets = ["native", "debian-openssl-3.0.x"]`), `.env.example` (`AUTO_SEED`). Test `server/test/autoseed.test.ts`.
- Produces: `maybeAutoSeed(): Promise<boolean>` in `server/src/services/demo.service.ts`. It seeds only when `process.env.AUTO_SEED === 'true'` and `prisma.user.count() === 0`, and returns whether it seeded.
- API image: build stage (`npm ci`, `prisma generate`, `tsc -p tsconfig.build.json`), runtime stage (production deps plus `node_modules/.prisma`, `dist`, `prisma/`). `CMD npx prisma migrate deploy && node dist/src/index.js`. Exposes 5000.
- Web image: Node build of the client, then `nginx:1.27-alpine` serving `dist` with an SPA fallback and `location /api/ { proxy_pass http://api:5000; }`. Exposes 80.
- Compose: `db` (`postgres:17-alpine`, healthcheck `pg_isready`, volume `pgdata`), `api` (depends on healthy db; `DATABASE_URL=postgresql://erp:erp@db:5432/minierp`, `JWT_SECRET=change-me-in-production`, `AUTO_SEED=true`, `NODE_ENV=production`, `COOKIE_SECURE=false`), `web` (port `8080:80`).
- The cookie's `secure` flag reads `COOKIE_SECURE` (default `NODE_ENV==='production'`) so plain-HTTP localhost Docker works.
- [ ] Step 1: Write failing tests: `maybeAutoSeed seeds an empty DB when AUTO_SEED=true`, `does nothing when users exist`, `does nothing when AUTO_SEED unset`. Run → FAIL.
- [ ] Step 2: Implement, run → PASS, and run the full suite.
- [ ] Step 3: Write the Docker files. `docker compose config` can't run locally (no Docker), so CI validates in Task 4.
- [ ] Step 4: Commit `build: docker compose for db, api and web`.

### Task 3: Playwright e2e
**Files:** Create `playwright.config.ts` (root), `e2e/demo-flow.spec.ts`, `e2e/roles.spec.ts`, `e2e/helpers.ts`, `e2e/screenshots.spec.ts` (tagged `@screens`, writes `docs/screenshots/*.png`, excluded by default via `grepInvert`).
- Config: `testDir: 'e2e'`, `use.baseURL: 'http://localhost:5173'`, Chromium only, `retries: process.env.CI ? 1 : 0`, `webServer` entries for `npm --prefix server run dev` (url `/api/health` on 5000) and `npm --prefix client run dev` (5173), `reuseExistingServer: !process.env.CI`.
- Helpers: `resetDemo(request)` (POST `/api/demo/reset`, tolerates 429 by waiting 16s and retrying once), `loginAs(page, role)` (clicks the demo button), `logout(page)`.
- `demo-flow.spec.ts`: the full flow through the UI (same steps as the live demo). It asserts, using role/text locators:
  - SO progress label "Level 2 of 4" after confirm
  - the MO appears in the Supply chain panel
  - after the MO confirm, the MO page shows the PO in its chain
  - after the inventory manager confirms the receipt, the PO shows 100%
  - after produce and confirm, the MO shows "Complete!"
  - after delivery and confirm, the SO shows "Fully delivered" and "Complete!"
- `roles.spec.ts`:
  - The Sales Manager menu has Sale Orders and lacks Purchase Orders.
  - The Business Owner order form has no Confirm/Edit buttons.
  - A sign-up shows "No access yet".
- [ ] Step 1: Install the Chromium browser (`npx playwright install chromium`).
- [ ] Step 2: Write the specs, run `npm run test:e2e`, and fix until green (no app behavior changes unless a real bug is found; ledger it).
- [ ] Step 3: Run `npx playwright test --grep @screens` to capture screenshots into `docs/screenshots/`.
- [ ] Step 4: Commit `test(e2e): playwright demo flow, roles and screenshots`.

### Task 4: GitHub Actions CI
**Files:** Create `.github/workflows/ci.yml`, `.github/dependabot.yml` (npm weekly for `/`, `/server` and `/client`; github-actions monthly).
- Jobs (all `ubuntu-latest`, `actions/setup-node@v4` with `node-version-file: .nvmrc` and npm cache):
  - `lint`: root `npm ci`, `npm run lint`, `npm run format:check`, server and client typecheck.
  - `test-server`: Postgres 17 service, write `server/.env.test`, `npm ci`, `npx vitest run` (no Windows retry wrapper needed).
  - `build-client`.
  - `e2e`: Postgres service, write `server/.env`, migrate, `npx playwright install --with-deps chromium`, `npm run test:e2e`, upload `playwright-report` on failure.
  - `docker`: `docker compose build` and `docker compose up -d`, wait for `http://localhost:8080/api/health`, `curl` the demo login, then `docker compose down`.
- [ ] Step 1: Write the workflow. Validate YAML by parsing it with node (the `yaml` package isn't installed, so use `npx --yes js-yaml`; if not allowed, rely on the first CI run).
- [ ] Step 2: Commit `ci: github actions for lint, tests, e2e and docker`.

### Task 5: README and finish
**Files:** Modify `README.md`: CI badge (`https://github.com/InfernoAnant/Mini_ERP/actions/workflows/ci.yml/badge.svg`), screenshots section, "Run with Docker" (`docker compose up --build`, then open http://localhost:8080), "Development" (Node 22 via `.nvmrc`, `npm run lint`/`test`/`test:e2e`), and the updated test counts.
- [ ] Step 1: Edit the README. Run `npm run format:check`.
- [ ] Step 2: Commit `docs: readme badge, screenshots and docker instructions`.
- [ ] Step 3: Final review (fresh reviewer), with a fix pass if needed.
- [ ] Step 4: Push `main` to `origin` (approved), then check the Actions run status via the GitHub API page. If CI fails, fix and push again.
