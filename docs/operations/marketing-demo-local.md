# Local marketing demo stack

The marketing landing is a separate Next.js repository. Prelude owns the
Candidate, realtime, interviewer, Postgres, and Redis parts of the demo. Local
development uses worktree-specific `.localhost` names and deterministic ports;
no host-file or machine DNS change is required.

Setup also appends `.localhost` to `NO_PROXY`/`no_proxy`, because otherwise a
developer-wide HTTP proxy may intercept these loopback requests.

## Namespace and isolation

Run `make init` once in every Prelude checkout. It creates a mode-`0600`,
gitignored `.env.worktree` and a non-secret `.worktree/metadata.env`.

The primary checkout uses `main`. Linked worktrees derive a short DNS-safe ID
from their path. For a cross-repository pair, choose the same explicit ID:

```bash
HIRECALL_WORKTREE_ID=issue-168 make init
```

`PRELUDE_WORKTREE_ID` is accepted as a compatibility alias. If both are set,
they must match. An initialized checkout refuses a different override so a
branch rename cannot silently point at another database or cookie namespace.

For an ID such as `issue-168`, the endpoints are:

- Landing: `http://www.hirecall-issue-168.localhost:<landing-port>`
- Console: `http://app.hirecall-issue-168.localhost:<console-port>`
- Candidate: `http://candidate.hirecall-issue-168.localhost:<candidate-port>`
- Realtime: `http://realtime.hirecall-issue-168.localhost:<realtime-port>`

The worktree ID is part of the parent cookie domain
(`hirecall-issue-168.localhost`), so even an intentionally domain-scoped
development cookie cannot cross into a different worktree. Do not set cookies
on the broader `.localhost` domain.

Non-primary worktrees receive one deterministic ten-port block in the range
`20000..59999`. Setup rejects aliases, collisions with registered worktrees,
and foreign listeners on Compose-owned ports. It also namespaces the Compose
project, volumes, networks, application image tags, and Redis worker keys.
The primary checkout retains the legacy ports and `prelude` volume names.

Inspect the current assignment without printing a secret:

```bash
make urls
make doctor
```

## Prerequisites

- Docker with Compose v2
- pnpm 10.26.0
- dotenvx
- valid LiveKit and OpenAI credentials in the encrypted root `.env`
- the team `.env.keys` in the primary checkout

`make init` copies `.env.keys` into linked worktrees when necessary and
generates independent admission, handoff, lead-delivery, unsubscribe, realtime,
and operations secrets. Secrets are never included in `make urls` output.

## Start and stop Prelude

```bash
make doctor
make demo-up
make demo-logs
```

`make demo-up` validates configuration, starts isolated Postgres and Redis,
applies committed Prisma migrations, seeds the predefined roles idempotently,
and starts realtime, the interviewer worker, and Candidate.

Stop only the demo application containers while preserving infrastructure and
data:

```bash
make demo-down
```

`make env-down` stops all containers in this worktree's Compose project.
`make env-reset` additionally deletes only this worktree's volumes and must be
used deliberately. `make cleanup` never removes containers, volumes, or data.

### Migrating an already-running legacy checkout

Do not regenerate `.env.worktree` while the old un-namespaced stack is still
running. First stop that stack with the code/configuration that started it,
then run `make init`, `make doctor`, `make urls`, and `make demo-up`. A linked
worktree moves to a fresh isolated database. The primary checkout continues to
use the existing `prelude_postgres_data` and `prelude_redis_data` volumes.

## Connect the separate landing repository

Generate a server-only integration file:

```bash
make landing-env
```

This writes `.worktree/marketing-landing.env` with mode `0600`. It contains the
shared admission bearer plus the generated public URLs and exact return target;
it is gitignored and `make cleanup` removes it only while its checksum still
proves setup ownership. Never copy its bearer into a `NEXT_PUBLIC_` variable.

Start the landing repository with its own local environment layered first:

```bash
cd /path/to/hirecall/website
dotenvx run \
  -f /path/to/Prelude/.worktree/marketing-landing.env \
  -f .env.local \
  -- sh -c 'pnpm dev -- --hostname 0.0.0.0 --port "$PORT"'
```

Dotenvx keeps the first value it encounters, so the generated integration file
must stay first. Landing-only values that are absent from it still come from
the website's `.env.local`.

The generated landing variables match the existing Next.js contract:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_APP_URL`
- `PRELUDE_CANDIDATE_URL`
- `MARKETING_DEMO_RETURN_TARGET`
- server-only `MARKETING_DEMO_SERVICE_SECRET`

No landing process needs database, Redis, realtime, encryption, or lead-worker
secrets.

## Exact return-target boundary

Candidate receives exactly two local result URLs:

1. the external landing: `www.<worktree-domain>/demo/result`;
2. the built-in Console demo: `app.<worktree-domain>/demo/result`.

They are generated as the comma-separated `MARKETING_DEMO_RETURN_TARGETS` value.
There are no wildcard origins, path prefixes, or arbitrary ports. The dedicated
`MARKETING_DEMO_LOCAL_RETURN_TARGET` remains the landing target used by the
Docker demo flow.

After Candidate redirects with an opaque `handoff` code, the landing BFF
consumes it once. The response contains predefined role metadata and a separate
short-lived, single-use lead-capture proof. Transcript, answers, email, prompt,
plan, organization, and draft data never cross this boundary or enter URLs,
browser storage, analytics, generic logs, or email metadata.

## Local lead delivery

Set `MARKETING_DEMO_LEAD_WEBHOOK_URL` to a local receiver. With Console running,
deliver its outbox and enforce retention with:

```bash
make marketing-demo-lead-operations
```

The command automatically uses this worktree's Console URL. The receiver must
deduplicate on `Idempotency-Key`. Payloads contain email, predefined role,
consent state/timestamps, event metadata, and a signed unsubscribe URL only.
