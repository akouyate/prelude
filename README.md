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
pnpm install                          # also configures the git pre-commit hook
brew install dotenvx                  # or: npm install -g @dotenvx/dotenvx
# Get the private `.env.keys` from the team (e.g. 1Password) and place it at the
# repo root — it decrypts the committed, encrypted `.env`.
make env-up
make db-generate
pnpm dev
```

The console app runs on `http://localhost:3000`.
The candidate app runs on `http://localhost:3001`.

## Environment & secrets

Config is encrypted with [dotenvx](https://dotenvx.com): a single committed root
`.env` holds ciphertext (DB, Clerk, realtime / LiveKit / OpenAI / ElevenLabs).
The private decryption key `.env.keys` is **gitignored** and shared out of band
(e.g. 1Password) — never commit it.

- The app `dev` scripts and the `Makefile` decrypt automatically (`dotenvx run` /
  `dotenvx get`), so `pnpm dev` and `make` just work once `.env.keys` is present.
- Edit a value with `dotenvx set KEY value` (re-encrypts in place); read one with
  `dotenvx get KEY`.
- A `.githooks/pre-commit` hook (auto-configured on `pnpm install`) runs
  `dotenvx ext precommit`, which blocks committing a decrypted `.env`.

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

Postgres listens on host port **5440** by default — `docker compose` and the
`Makefile` both default `POSTGRES_PORT` to 5440, and the encrypted `.env` points
`DATABASE_URL` there. Override it if that port is taken (and align `DATABASE_URL`):

```bash
POSTGRES_PORT=5441 make env-up
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

`make env-reset` removes the local Docker volume and should only be used when you want a clean database. Secrets live in the dotenvx-encrypted `.env` (committed as ciphertext); the decryption key `.env.keys` stays out of git.

Use `MIGRATION_NAME=your_migration_name make db-migrate` when adding a new Prisma migration.

Console auth is controlled by `CONSOLE_AUTH_PROVIDER`:

- `auto` uses real Clerk when keys are configured and falls back to a local mock
  identity in development when keys are empty.
- `clerk` requires `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
- `mock` forces the local `MOCK_CLERK_*` identity for smoke tests and demos.

Production never allows the mock provider. For real auth E2E, follow Clerk's
testing guidance with fixed OTP test identities, short-lived session tokens, or
Clerk testing tokens instead of the local mock.

Console Playwright tests default to `CONSOLE_AUTH_PROVIDER=mock` for fast product
smoke coverage. To exercise real Clerk screens, run with
`CONSOLE_AUTH_PROVIDER=clerk` and dev-instance Clerk keys. The console uses
`@clerk/testing` to run Clerk's Playwright setup and inject a Testing Token when
real Clerk auth is enabled. You can either let Clerk fetch the token from
`CLERK_SECRET_KEY` or provide `CLERK_TESTING_TOKEN` yourself.

`make e2e-smoke` uses the same local mock Clerk identity by default
(`MOCK_CLERK_USER_ID` / `MOCK_CLERK_ORG_ID`), so the dashboard and interview
detail URLs printed by the smoke report should open directly in the local
console.

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
successfully when the report is generated. Use the strict variant (below) to fail
the build on lifecycle anomalies.

Use the strict variant after a real LiveKit/OpenAI mobile test when the result
should block release:

```bash
make live-smoke-report-strict SESSION_ID=is_xxx
```

Strict mode fails on lifecycle anomalies such as missing `session_closing`,
missing closing transcript evidence, provider errors, non-contiguous events, or
completion before candidate media readiness.

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

Role screen creation uses the server-side interview draft generator. Product
generation uses OpenAI when `OPENAI_API_KEY` and `INTERVIEW_DRAFT_GENERATOR=openai`
are configured; automated console E2E tests force
`INTERVIEW_DRAFT_GENERATOR=deterministic` so CI never pays for draft generation.
To run the explicit paid provider smoke locally:

```bash
ALLOW_LIVE_LLM_TESTS=1 pnpm --dir apps/console exec vitest run src/server/interviews/interview-draft-generation.live.test.ts
```

## Further documentation

- [`docs/architecture/v1-e2e-release-workflow.md`](docs/architecture/v1-e2e-release-workflow.md) — V1 end-to-end release workflow.
- [`docs/operations/live-ia-commercial-poc-checklist.md`](docs/operations/live-ia-commercial-poc-checklist.md) — live IA commercial POC checklist.
- [`docs/operations/compliance-trust-guardrails.md`](docs/operations/compliance-trust-guardrails.md) — compliance and candidate trust guardrails.
- [`docs/sources/evaluation-matrix.md`](docs/sources/evaluation-matrix.md) — evaluation matrix sources.
- [`docs/sources/role-draft-generation.md`](docs/sources/role-draft-generation.md) — role draft generation sources.
- [`docs/sources/compliance-guardrails.md`](docs/sources/compliance-guardrails.md) — compliance guardrail source rationale.
