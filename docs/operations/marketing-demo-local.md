# Local marketing demo stack

The marketing landing page is a separate Next.js application. Keep it running
on the host at `http://localhost:3200`; Prelude supplies the candidate interview
runtime as a Docker Compose profile.

## Prerequisites

- Docker with Compose v2
- pnpm 10.26.0
- dotenvx; run `make init` once in each checkout
- valid local LiveKit and OpenAI credentials

The committed `.env` remains the canonical encrypted environment file. Do not
rename it to `.env.local` and do not create a decrypted copy. `make init`
reuses the primary worktree's gitignored `.env.keys` and generates local-only
values in a mode-`0600`, gitignored `.env.worktree`. The `demo:*` scripts load
both files, with worktree values taking precedence, so every local service uses
the same generated secrets. As with all Docker environment variables, a local
operator with Docker access can inspect the running container configuration.

The encrypted shared environment must define:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`

`make init` generates `MARKETING_DEMO_SERVICE_SECRET`,
`MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY`, and `REALTIME_API_KEY` for the current
worktree. Configure the landing page server with that worktree's
`MARKETING_DEMO_SERVICE_SECRET`; never expose it to browser code.

Never prefix these values with `NEXT_PUBLIC_` or send them to the browser.

## Start and stop

```bash
make doctor
pnpm demo:up
```

This starts Postgres and Redis, applies committed Prisma migrations, seeds the
predefined demo roles idempotently, then starts the Go realtime API, Python
interviewer auto-worker, and Candidate app.

A one-shot configuration check runs first and names any missing required
variable without printing its value. No migration or application service starts
when this check fails.

The scripts preserve Prelude's established local infrastructure ports:
Postgres on `5440` and Redis on `6380`.

The stable host endpoints are:

- Candidate: `http://localhost:3101`
- Realtime health: `http://localhost:8080/health`
- Landing page return target: `http://localhost:3200/demo/result`

Follow the application logs with:

```bash
pnpm demo:logs
```

Stop and remove only the marketing-demo application containers with:

```bash
pnpm demo:down
```

Postgres and Redis keep running and their named volumes are preserved. Use the
existing `make env-down` or `make env-reset` commands only when intentionally
stopping or deleting the shared local infrastructure.

## Port overrides

The defaults can be overridden without editing Compose:

```bash
CANDIDATE_PORT=13101 REALTIME_PORT=18080 pnpm demo:up
```

The Candidate-generated preview URL follows `CANDIDATE_PORT`. The realtime URL
used inside Docker remains `http://realtime:8080`.

To test a landing page on a different local port, override its exact return
target:

```bash
MARKETING_DEMO_LOCAL_RETURN_TARGET=http://localhost:3300/demo/result pnpm demo:up
```

Return-target matching is exact after URL normalization; do not add a trailing
slash unless the landing page sends the same value.

## Landing page contract

The landing page browser calls its own same-origin BFF. The landing page server
then calls Candidate's service-authenticated internal endpoints at
`http://localhost:3101`. It must verify Turnstile before admission and keep
`MARKETING_DEMO_SERVICE_SECRET` server-only.

No landing-page process needs direct access to Postgres, Redis, or the realtime
API.

After Candidate redirects to the exact allow-listed result URL with an opaque
`handoff` code, the landing page server consumes that code once through
`POST /api/internal/marketing-demo-handoffs/exchange`. The response is limited
to predefined, non-candidate metadata:

```json
{
  "completed": true,
  "roleSlug": "account-executive",
  "roleTitle": "Account Executive",
  "roleVersion": 1
}
```

Transcript events are deleted before the redirect code is exposed. Transcript,
answers and email must never be added to this response, URLs, browser storage,
analytics or generic logs. The landing page selects its own role-specific
synthetic sample from `roleSlug`.
