# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Prelude.ai is a pre-interview product for SMBs and scale-ups: recruiters turn a job posting into a short, guided **live IA (AI) interview**, then review a candidate brief before deciding who to call. The differentiator is a live, voice-based AI interviewer that feels structured and human — not a chatbot and not just a generated form.

The repo is a **pnpm + Turborepo monorepo** (two Next.js apps + shared packages) plus **two standalone backend services** (`services/`) that are *not* part of the pnpm workspace and have their own toolchains (Go, Python).

## Commands

All JS/TS commands run from the repo root via Turborepo (`pnpm <script>` fans out across the workspace):

```bash
pnpm dev          # turbo run dev — but prefer `make dev` (starts Docker infra first)
pnpm build
pnpm lint
pnpm typecheck    # tsc --noEmit per package
pnpm test         # vitest run (unit)
pnpm test:e2e     # playwright
```

Scope to one package/app with `--filter` or `--dir`, and run a single test with Vitest/Playwright directly:

```bash
pnpm --filter @prelude/console test
pnpm --dir apps/console exec vitest run src/server/interviews/interview-drafts.test.ts
pnpm --filter @prelude/core exec vitest run -t "review"     # by test name
pnpm --dir apps/console exec playwright test e2e/dashboard.spec.ts
```

### Local infra, DB, and services (Makefile)

`make help` lists everything. Postgres + Redis run via Docker Compose; `packages/db` owns Prisma.

```bash
make dev                 # bring up infra, then run the app dev stack
make env-up / env-down   # start/stop Docker (Postgres + Redis); env-reset deletes volumes
make db-migrate          # MIGRATION_NAME=add_x make db-migrate to create a migration
make db-generate         # regenerate Prisma client (run after schema.prisma changes)
make db-studio / db-shell / redis-shell
```

The backend services are driven through `make`, not pnpm:

```bash
make test-services                              # Go + Python service unit tests (pnpm test skips services/)
make test-realtime / test-agent                 # the Go / Python suites individually
make live-openai-worker SESSION_ID=is_xxx       # Python live interviewer worker (uv)
make live-openai-autoworker                     # Redis-backed Python auto-worker
make agent-benchmark / agent-role-benchmark     # Python provider/role benchmark harness
make live-smoke-report SESSION_ID=is_xxx        # replayability report from the Go realtime API
```

### End-to-end smoke

```bash
make db-migrate
make e2e-smoke E2E_SMOKE_RUN_ID=local-v1        # seeds a full V1 dataset (mocked LLM, repeatable)
```

`E2E_SMOKE_RESET=1` resets only that run's data. It prints dashboard/interview/candidate URLs that open directly in the local console.

## Architecture

### Monorepo layout

- `apps/console` (`@prelude/console`, port 3000) — recruiter console, desktop-first. Next.js App Router with route groups: `(workspace)`, `(onboarding)`, `(marketing)`, `(auth)`. Business logic lives in `src/server/<domain>` (server actions + loaders), UI in `src/features/<feature>`.
- `apps/candidate` (`@prelude/candidate`, port 3001) — public candidate micro-app, mobile-first. Uses `livekit-client` to join interview rooms. Exposes `app/api/*` route handlers for candidate/live sessions.
- `packages/*` (all `@prelude/*`, consumed via `workspace:*`):
  - `types` — pure TS business types
  - `contracts` — **Zod schemas + DTOs** (the validation/serialization boundary)
  - `core` — testable domain logic & policies (`src/domain`, `src/policies`); no I/O
  - `db` — Prisma schema + client singleton (exported from `./src/client.ts`)
  - `ui`, `design-system` (Tailwind 4 preset + tokens), `config` (shared tsconfig/eslint), `testing`

Stack: Next 16, React 19, Tailwind 4, Clerk auth, TanStack Query, Vitest 4, Playwright, Prisma/Postgres + Redis.

### Live IA interview pipeline (`services/` — outside the pnpm workspace)

The live interview is **Go + LiveKit + Python** by deliberate design. Read `docs/architecture/live-ia-interviewer.md` before touching this path.

- `services/realtime` — **Go control plane** ("Prelude Realtime API"). Owns session orchestration and an **append-only Postgres event store**; mints short-lived LiveKit join tokens; ingests realtime events idempotently. Lightweight clean architecture (`domain` / `application` / `adapters/{httpapi,livekit,store,redisqueue}`). It deliberately **rejects payloads/metadata whose keys look like secrets** (api keys, auth headers, tokens). It does *not* own question-progression policy — that lives in the Python worker.
- `services/interviewer-agent` — **Python LiveKit Agent** runtime (the IA interviewer loop). Runs in the LiveKit room, talks to OpenAI Realtime (primary voice) with ElevenLabs as benchmark/fallback, and reports events back to the Go API. Managed with `uv`.

Boundaries: browsers never hold provider secrets and never call OpenAI/ElevenLabs directly; interview-state authority is server-side, not in the browser.

### Domain spine (the model that matters)

See `docs/architecture/v1-domain-spine.md`. Canonical flow:

```
Organization → Job → InterviewDraft → Interview → CandidateSession
            → LiveInterviewSession / LiveInterviewEvent → CandidateBrief → Recruiter review
```

Key distinctions to respect:

- **`CandidateSession` is the durable product aggregate** for a candidate result. Recruiter-facing pages should start from `CandidateSession`, *not* from `LiveInterviewSession`.
- **`LiveInterviewSession` is runtime evidence** from the realtime service, linked via `CandidateSession.realtimeSessionId`. Rooms can fail/retry, so it is never the primary product record.
- **`InterviewDraft` is the editable recruiter workspace**; **`Interview` is the published, immutable snapshot** the candidate link resolves to. Don't conflate them.
- **All console reads/writes must be scoped by `organizationId`.** The Organization owns all recruiter data.

## Conventions & gotchas

- **Auth provider** is controlled by `CONSOLE_AUTH_PROVIDER` (`auto` | `clerk` | `mock`). `auto` uses real Clerk when keys exist and falls back to a local mock identity in dev. **Production never allows `mock`.** Console Playwright tests default to `mock`; use `clerk` + dev keys (via `@clerk/testing`) to exercise real auth screens.
- **Interview draft generation** is controlled by `INTERVIEW_DRAFT_GENERATOR` (`deterministic` | `openai`). Automated console E2E **forces `deterministic`** so CI never pays for generation. Live generation is in `apps/console/src/server/interviews/interview-draft-generation.ts`.
- **Paid/live LLM is opt-in and gated by `ALLOW_LIVE_LLM_TESTS=1`** (e.g. `*.live.test.ts`, `make e2e-smoke-live`, benchmarks). Never run live-LLM paths in CI.
- After editing `packages/db/prisma/schema.prisma`, run `make db-generate` (and `MIGRATION_NAME=... make db-migrate` to migrate).
- Cross-package validation goes through `@prelude/contracts` (Zod). Keep pure business rules in `@prelude/core` (it's the package with the densest unit tests).
- Reference docs live under `docs/{architecture,operations,research,sources}/`; `docs/sources/*` track the rationale/sources behind generated content and compliance guardrails.

## Issue tracking & project planning

**The GitHub Projects board is the single source of truth for status and progression — do not track progress in this repo (README/CLAUDE.md/docs).** This section documents only the stable *conventions* for navigating the board, not its current state. When picking up a task, find its issue on GitHub (`akouyate/prelude`) and read the parent **`type:epic`** for context.

- **Milestones = release phases:** `V1 E2E Demo` → `V1 Commercial POC` → `Post-V1 Research`.
- **`type:`** `epic` (large initiative) · `task` (actionable) · `research` (benchmark/exploration).
- **`priority:`** `P0` (critical path for V1) · `P1` · `P2`.
- **`scope:v1-e2e`** marks issues in the real-data V1 end-to-end workflow; **`constraint:real-data-only`** is a hard product rule — **product UI must render persisted real data, never mocks** (this is why E2E seeds real Postgres rather than stubbing).
- **`area:` labels map to the code:** `workspace` → console `(workspace)`/`(onboarding)` + `src/server/{auth,organizations,onboarding}`; `candidate` → `apps/candidate`; `job-builder` → `InterviewDraft`/`Interview` + `src/features/interview-agent`; `ai-synthesis` → `CandidateBrief` + `src/server/interviews/candidate-brief-*`; `realtime` → `services/realtime` + `services/interviewer-agent`; `recruiter-review` → `src/features/{dashboard,interview-detail}` + `candidate-review-*`; `compliance` → `docs/operations/compliance-*`.

Use `gh issue list --repo akouyate/prelude --label type:epic` to see the epics. Enumerating the Projects board itself needs `gh auth refresh -s read:project`.
