# Prelude.ai

Prelude.ai is a focused pre-interview product for SMBs, small mid-market companies, and scale-ups. It helps recruiters turn a job posting into a short guided candidate pre-interview, then review a clear candidate brief before deciding who to call.

This repository is a pnpm/Turborepo monorepo with two Next.js App Router apps and shared packages for UI, design tokens, contracts, data access, and domain logic.

## Apps

- `apps/console`: recruiter console, desktop-first and responsive.
- `apps/candidate`: public candidate micro-app, mobile-first.

## Packages

- `@prelude/ui`: reusable UI components and shells.
- `@prelude/design-system`: design tokens and shared Tailwind preset.
- `@prelude/types`: pure TypeScript business types.
- `@prelude/contracts`: Zod schemas and DTO contracts.
- `@prelude/db`: Prisma schema and client singleton.
- `@prelude/core`: testable business logic and policies.
- `@prelude/config`: shared TypeScript and ESLint config.
- `@prelude/testing`: shared test helpers.

## Local Setup

```bash
corepack enable
pnpm install
cp .env.example .env
make env-up
make db-generate
pnpm dev
```

The console app runs on `http://localhost:3000`.
The candidate app runs on `http://localhost:3001`.

## Scripts

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

## Database

`packages/db` owns Prisma. Local development uses Postgres through Docker Compose.

The default local connection string is committed in `.env.example`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/prelude?schema=public"
```

If port `5432` is already used on your machine, start Postgres on another host port and align `DATABASE_URL` in `.env`:

```bash
POSTGRES_PORT=5433 make env-up
```

Useful local commands:

```bash
make help
make env-up
make db-generate
make db-migrate
make db-shell
make db-logs
make env-down
make env-reset
```

`make env-reset` removes the local Docker volume and should only be used when you want a clean database. Keep real secrets in `.env`; it is ignored by git.

Use `MIGRATION_NAME=your_migration_name make db-migrate` when adding a new Prisma migration.

## Live Interview Smoke Report

After a live interview smoke, generate a replayability report from the Go realtime API:

```bash
make live-smoke-report SESSION_ID=is_xxx
```

By default, the report reads from `http://127.0.0.1:8080`. Override it when the
realtime API runs elsewhere:

```bash
make live-smoke-report SESSION_ID=is_xxx REALTIME_API_URL=http://127.0.0.1:18081
```

The readiness gate expects both `candidate_joined` and `candidate_media_ready`.
`candidate_media_ready` is emitted only after the browser has published the local
microphone/camera tracks. The report prints session status, event counts,
transcript coverage, readiness gate checks, completion metrics, warnings,
anomalies, and a `Pass`, `Retry needed`, or `Blocker` decision. It exits
successfully when the report is generated; use
`node scripts/live-smoke-report.mjs --strict` later if this needs to become a CI
gate. The full enterprise dashboard view belongs to issue #21.

## V1 E2E Smoke

Create a repeatable local V1 workflow dataset with real Postgres persistence:

```bash
make db-migrate
make e2e-smoke E2E_SMOKE_RUN_ID=local-v1
```

The smoke command starts local Postgres and expects the local schema to be
migrated. It creates an onboarded organization, job, published interview,
candidate session, runtime events, transcript evidence, and a persisted candidate
brief. It prints the dashboard, interview detail, candidate detail, and public
candidate URLs. By default it uses mocked LLM output and is safe to repeat
locally; `E2E_SMOKE_RESET=1` resets only the matching smoke run data.

Paid/live LLM mode is explicit:

```bash
ALLOW_LIVE_LLM_TESTS=1 make e2e-smoke-live E2E_SMOKE_RUN_ID=local-v1-live
```

Do not run live LLM smoke in CI.

The step-by-step release workflow and remaining slice risks are documented in
[`docs/architecture/v1-e2e-release-workflow.md`](docs/architecture/v1-e2e-release-workflow.md).
