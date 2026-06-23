# Production Go-Live Runbook — Live IA Interviewer

Parent epic: #11. Companion to `live-ia-commercial-poc-checklist.md` (demo
readiness). This runbook covers turning the **code-ready** live path into a
**deployed** one. It assumes the application code on `main`.

## What is code-ready (no further code required)

- The recruiter → published `Interview` → candidate `CandidateSession` → live
  room → `LiveInterviewEvent` → `CandidateBrief` spine is wired on real data.
- The Go control plane loads the real published interview plan (#94) and
  creates the LiveKit room on session creation (#95).
- The interviewer honours recruiter-authored, compliance-scanned questions and
  one signal-aware follow-up (E1), runs a warm, valence-invariant persona that
  never infers emotion from voice and never reveals the evaluation (E2/E3), and
  gives a candidate a duty-of-care exit that closes without scoring (E4).
- **Mock interview paths are default-deny and hard-denied in production** (#96):
  the candidate app refuses a `mock_lk_*` room with a 502, and the Python worker
  refuses `--skip-openai-handshake` / a mock token unless `ALLOW_MOCK_INTERVIEW`
  is set in a non-production env.
- **The realtime service fails fast in production** on missing
  `DATABASE_URL` / `REDIS_URL` / `LIVEKIT_*` instead of silently degrading (#97).
- The realtime Postgres schema is reproducible from the committed Prisma
  migration `20260618070500_live_interview_event_store`.

## Required production configuration

Set `APP_ENV=production` everywhere. Do **not** set `ALLOW_MOCK_INTERVIEW`.

**Go realtime service** (`services/realtime`) — refuses to start without:
- `DATABASE_URL` — same Postgres the console uses (Prisma-managed schema).
- `REDIS_URL` — agent dispatch; without it agents never join.
- `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
- Recommended: `LIVE_INTERVIEW_PROVIDER=openai_realtime`, `PORT`,
  `AGENT_JOIN_STREAM_KEY`.

**Python interviewer agent** (`services/interviewer-agent`, the autoworker):
- `OPENAI_API_KEY` + `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` /
  `OPENAI_REALTIME_TURN_DETECTION` / `OPENAI_REALTIME_REASONING_EFFORT`
  (the worker refuses a real handshake without these).
- `REALTIME_API_URL` (the Go API), `REALTIME_API_KEY`, `REDIS_URL`, `APP_ENV`.

**Candidate app** (`apps/candidate`):
- ⚠️ `PRELUDE_REALTIME_API_URL` — the candidate app reads **this** name, which is
  **distinct** from the worker's `REALTIME_API_URL`. If only `REALTIME_API_URL`
  is set, the candidate app falls back to `http://127.0.0.1:8080` and live
  interviews break. Set `PRELUDE_REALTIME_API_URL` to the deployed Go API.
- `APP_ENV=production`, `DATABASE_URL`.

**Console app** (`apps/console`):
- `CONSOLE_AUTH_PROVIDER=clerk` with real Clerk keys (mock auth is refused in
  production), `DATABASE_URL`, `INTERVIEW_DRAFT_GENERATOR=openai` +
  `OPENAI_API_KEY`, and the protected-topic classifier config.

## Deploy order

1. `prisma migrate deploy` against the production Postgres (creates/updates the
   console + realtime schema).
2. Deploy the Go realtime service (fails fast if config is incomplete — that is
   the desired behaviour).
3. Deploy the Python autoworker (`make live-openai-autoworker` equivalent) with
   the OpenAI Realtime + Redis + realtime-API config.
4. Deploy the console and candidate apps with `PRELUDE_REALTIME_API_URL` set.
5. Confirm a LiveKit project (Cloud or self-hosted) is reachable from the Go
   service and the candidate browser.

## Verification before opening to real candidates

1. Deterministic spine smoke (no paid calls):
   `make db-migrate && make e2e-smoke E2E_SMOKE_RUN_ID=prod-rehearsal`.
2. One real end-to-end live interview on desktop and mobile Chrome: publish a
   plan, open the candidate link, grant the microphone, answer, ask for one
   repeat, and trigger a stop request to confirm the duty-of-care close. The
   agent must join, audio must flow, and events must persist.
3. `make live-smoke-report SESSION_ID=is_xxx` for the replayability report, and
   capture the evidence listed in `live-ia-commercial-poc-checklist.md`.

## Out of scope for this runbook (operator-owned)

Provisioning the LiveKit project, OpenAI Realtime quota/secrets, the Redis and
Postgres instances, the deploy targets, secret storage, and TLS — plus the real
end-to-end live run above — require infrastructure and credentials that are not
in the repository.
